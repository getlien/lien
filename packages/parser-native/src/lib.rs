#![deny(clippy::all)]

//! napi-rs bridge that parses source with tree-sitter and returns one JSON
//! string per parse (the wire format frozen in
//! `docs/architecture/native-parser.md`). No node text crosses the FFI
//! boundary -- only byte offsets; the JS/TS side slices text out of the
//! original source lazily. See ADR-013 for why: traversal, not parsing, was
//! the FFI cost this crate exists to eliminate, and returning individual
//! fields per node (a live object graph) reintroduces exactly that cost.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt::Write as _;
use tree_sitter::{Language, Node, Parser, TreeCursor};

/// Canonical language ids. Must match `LANGUAGE_IDS` in
/// `packages/parser/src/ast/languages/registry.ts` exactly -- these are the
/// only strings `parseTree()` accepts.
const SUPPORTED_LANGUAGES: &[&str] = &[
    "typescript",
    "javascript",
    "php",
    "python",
    "rust",
    "go",
    "java",
    "csharp",
    "ruby",
    "kotlin",
    "swift",
];

/// Resolves a lien language id to the tree-sitter grammar export lien uses
/// today. Per docs/architecture/native-parser.md §4: TypeScript routes both
/// `.ts`/`.tsx` through the plain TypeScript grammar (not TSX), and PHP uses
/// the full PHP grammar (not the php-only variant).
fn language_for(lang: &str) -> Option<Language> {
    match lang {
        "typescript" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "javascript" => Some(tree_sitter_javascript::LANGUAGE.into()),
        "php" => Some(tree_sitter_php::LANGUAGE_PHP.into()),
        "python" => Some(tree_sitter_python::LANGUAGE.into()),
        "rust" => Some(tree_sitter_rust::LANGUAGE.into()),
        "go" => Some(tree_sitter_go::LANGUAGE.into()),
        "java" => Some(tree_sitter_java::LANGUAGE.into()),
        "csharp" => Some(tree_sitter_c_sharp::LANGUAGE.into()),
        "ruby" => Some(tree_sitter_ruby::LANGUAGE.into()),
        // Vendored crate ships an old-style `extern "C"` binding whose
        // `language()` already returns `tree_sitter::Language` -- no `.into()`.
        "kotlin" => Some(tree_sitter_kotlin::language()),
        "swift" => Some(tree_sitter_swift::LANGUAGE.into()),
        _ => None,
    }
}

thread_local! {
    // One cached Parser per language per thread (napi worker threads reuse
    // threads across calls), so `set_language` only runs once per language
    // per thread rather than once per parse.
    static PARSERS: RefCell<HashMap<String, Parser>> = RefCell::new(HashMap::new());
}

fn with_parser<T>(lang: &str, f: impl FnOnce(&mut Parser) -> T) -> std::result::Result<T, String> {
    PARSERS.with(|cell| {
        let mut map = cell.borrow_mut();
        if !map.contains_key(lang) {
            let language = language_for(lang).ok_or_else(|| {
                format!(
                    "unsupported language: \"{lang}\" (valid languages: {})",
                    SUPPORTED_LANGUAGES.join(", ")
                )
            })?;
            let mut parser = Parser::new();
            parser
                .set_language(&language)
                .map_err(|e| format!("set_language failed for {lang}: {e}"))?;
            map.insert(lang.to_string(), parser);
        }
        let parser = map.get_mut(lang).unwrap();
        Ok(f(parser))
    })
}

/// Escapes a `&str` into a JSON string literal (including the surrounding
/// quotes), appending to `out`. Hand-rolled (no serde_json) -- the spike
/// measured this ~8-15x faster than routing the tree through
/// `serde_json::Value`, and this JSON only ever crosses the napi FFI
/// boundary once per file, never a network.
fn write_json_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Swift-only: a second field name attached to the same child position as
/// `primary`, if one exists.
///
/// Background: tree-sitter lets one child position carry *multiple* field
/// names when a grammar nests `field()` calls around a shared hidden rule
/// (`field("return_type", field("name", $._unannotated_type))` is exactly
/// this pattern in `tree-sitter-swift`'s grammar.js, used for return types,
/// parameter/property type annotations, `inherits_from`, and `must_equal`).
/// `TreeCursor::field_name()` (what `write_optional_fields` calls for the
/// common `field` key) only ever surfaces *one* of them -- empirically the
/// innermost ("name"), never the outer one lien's extractors actually query
/// (e.g. `return_type`). `Node::child_by_field_id`, by contrast, does a
/// direct field-table lookup and finds the child regardless of which name
/// the cursor would report -- exactly what `node-tree-sitter`'s
/// `childForFieldName()` uses under the hood, which is why the legacy
/// backend never showed this bug.
///
/// None of the other ten grammars double-tag a field lien's extractors
/// read, so this extra per-node scan is gated to Swift only -- zero cost for
/// every other language.
fn secondary_field_name<'a>(node: &Node<'a>, primary: Option<&str>) -> Option<&'static str> {
    let parent = node.parent()?;
    let language = node.language();
    let field_count = u16::try_from(language.field_count()).unwrap_or(u16::MAX);
    (1..=field_count).find_map(|id| {
        let name = language.field_name_for_id(id)?;
        if Some(name) == primary {
            return None;
        }
        parent
            .child_by_field_id(id)
            .filter(|candidate| candidate == node)
            .map(|_| name)
    })
}

/// Writes the `field`/`field2` keys for `node`, given its cursor-reported
/// `field` name. Split out of `write_optional_fields` to keep that
/// function's cognitive complexity down -- `field2` is Swift-only, see
/// `secondary_field_name`.
fn write_field(out: &mut String, node: &Node, field: &str, lang: &str) {
    out.push_str(",\"field\":");
    write_json_string(out, field);

    if lang == "swift" {
        if let Some(field2) = secondary_field_name(node, Some(field)) {
            out.push_str(",\"field2\":");
            write_json_string(out, field2);
        }
    }
}

/// Writes the omitted-default fields (§1.1): `named`/`field`/`field2`/
/// `hasError`/`isMissing` are only emitted when they differ from their
/// common-case default (true / absent / absent / false / false
/// respectively). `field2` is Swift-only -- see `secondary_field_name`.
fn write_optional_fields(out: &mut String, cursor: &TreeCursor, lang: &str) {
    let node = cursor.node();

    // Omitted when true (the common case) -- presence always means false.
    if !node.is_named() {
        out.push_str(",\"named\":false");
    }

    // Omitted when the node has no field name under its parent.
    if let Some(field) = cursor.field_name() {
        write_field(out, &node, field, lang);
    }

    // Omitted when false (the common case) -- presence always means true.
    if node.has_error() {
        out.push_str(",\"hasError\":true");
    }

    // Omitted when false (the common case) -- presence always means true.
    if node.is_missing() {
        out.push_str(",\"isMissing\":true");
    }
}

/// Depth-first serialize of `cursor`'s children into the `"children":[...]`
/// array, comma-joined, recursing back into `write_node` for each. Split out
/// of `write_node` to keep that function's cognitive complexity down -- the
/// sibling-walk loop and the recursive call are the bulk of its cost.
fn write_children(out: &mut String, cursor: &mut TreeCursor, lang: &str) {
    out.push_str(",\"children\":[");
    if cursor.goto_first_child() {
        let mut first = true;
        loop {
            if !first {
                out.push(',');
            }
            first = false;
            write_node(out, cursor, lang);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
        cursor.goto_parent();
    }
    out.push(']');
}

/// Depth-first serialize using a single shared `TreeCursor` (no per-node
/// cursor allocation). Node shape matches docs/architecture/native-parser.md
/// §1 exactly; the omitted-default fields and the children array are
/// delegated to `write_optional_fields`/`write_children` respectively.
/// `lang` is threaded through only for `write_optional_fields`'s Swift-only
/// `field2` check (`secondary_field_name`) -- it plays no other role here.
fn write_node(out: &mut String, cursor: &mut TreeCursor, lang: &str) {
    let node = cursor.node();
    out.push('{');

    out.push_str("\"type\":");
    write_json_string(out, node.kind());

    let _ = write!(
        out,
        ",\"startIndex\":{},\"endIndex\":{},\"startRow\":{},\"startCol\":{},\"endRow\":{},\"endCol\":{}",
        node.start_byte(),
        node.end_byte(),
        node.start_position().row,
        node.start_position().column,
        node.end_position().row,
        node.end_position().column,
    );

    write_optional_fields(out, cursor, lang);
    write_children(out, cursor, lang);

    out.push('}');
}

/// Parses `source` as `lang` and returns the whole tree serialized as one
/// JSON string, depth-first with `children` nested inline (see
/// docs/architecture/native-parser.md §1). `lang` must be one of
/// `SUPPORTED_LANGUAGES`; anything else is a napi `Error` naming the valid ids.
#[napi]
pub fn parse_tree(lang: String, source: String) -> Result<String> {
    with_parser(&lang, |parser| {
        let tree = parser
            .parse(&source, None)
            .ok_or_else(|| "tree-sitter parse() returned None".to_string())?;
        let mut out = String::with_capacity(source.len() * 2);
        let mut cursor = tree.walk();
        write_node(&mut out, &mut cursor, &lang);
        Ok(out)
    })
    .map_err(|e: String| Error::from_reason(e))?
    .map_err(|e: String| Error::from_reason(e))
}
