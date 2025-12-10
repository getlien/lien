var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/balanced-match/index.js
var require_balanced_match = __commonJS({
  "../../node_modules/balanced-match/index.js"(exports, module) {
    "use strict";
    module.exports = balanced;
    function balanced(a, b, str) {
      if (a instanceof RegExp) a = maybeMatch(a, str);
      if (b instanceof RegExp) b = maybeMatch(b, str);
      var r = range(a, b, str);
      return r && {
        start: r[0],
        end: r[1],
        pre: str.slice(0, r[0]),
        body: str.slice(r[0] + a.length, r[1]),
        post: str.slice(r[1] + b.length)
      };
    }
    function maybeMatch(reg, str) {
      var m = str.match(reg);
      return m ? m[0] : null;
    }
    balanced.range = range;
    function range(a, b, str) {
      var begs, beg, left, right, result;
      var ai = str.indexOf(a);
      var bi = str.indexOf(b, ai + 1);
      var i = ai;
      if (ai >= 0 && bi > 0) {
        if (a === b) {
          return [ai, bi];
        }
        begs = [];
        left = str.length;
        while (i >= 0 && !result) {
          if (i == ai) {
            begs.push(i);
            ai = str.indexOf(a, i + 1);
          } else if (begs.length == 1) {
            result = [begs.pop(), bi];
          } else {
            beg = begs.pop();
            if (beg < left) {
              left = beg;
              right = bi;
            }
            bi = str.indexOf(b, i + 1);
          }
          i = ai < bi && ai >= 0 ? ai : bi;
        }
        if (begs.length) {
          result = [left, right];
        }
      }
      return result;
    }
  }
});

// ../../node_modules/brace-expansion/index.js
var require_brace_expansion = __commonJS({
  "../../node_modules/brace-expansion/index.js"(exports, module) {
    "use strict";
    var balanced = require_balanced_match();
    module.exports = expandTop;
    var escSlash = "\0SLASH" + Math.random() + "\0";
    var escOpen = "\0OPEN" + Math.random() + "\0";
    var escClose = "\0CLOSE" + Math.random() + "\0";
    var escComma = "\0COMMA" + Math.random() + "\0";
    var escPeriod = "\0PERIOD" + Math.random() + "\0";
    function numeric(str) {
      return parseInt(str, 10) == str ? parseInt(str, 10) : str.charCodeAt(0);
    }
    function escapeBraces(str) {
      return str.split("\\\\").join(escSlash).split("\\{").join(escOpen).split("\\}").join(escClose).split("\\,").join(escComma).split("\\.").join(escPeriod);
    }
    function unescapeBraces(str) {
      return str.split(escSlash).join("\\").split(escOpen).join("{").split(escClose).join("}").split(escComma).join(",").split(escPeriod).join(".");
    }
    function parseCommaParts(str) {
      if (!str)
        return [""];
      var parts = [];
      var m = balanced("{", "}", str);
      if (!m)
        return str.split(",");
      var pre = m.pre;
      var body = m.body;
      var post = m.post;
      var p = pre.split(",");
      p[p.length - 1] += "{" + body + "}";
      var postParts = parseCommaParts(post);
      if (post.length) {
        p[p.length - 1] += postParts.shift();
        p.push.apply(p, postParts);
      }
      parts.push.apply(parts, p);
      return parts;
    }
    function expandTop(str) {
      if (!str)
        return [];
      if (str.substr(0, 2) === "{}") {
        str = "\\{\\}" + str.substr(2);
      }
      return expand2(escapeBraces(str), true).map(unescapeBraces);
    }
    function embrace(str) {
      return "{" + str + "}";
    }
    function isPadded(el) {
      return /^-?0\d/.test(el);
    }
    function lte(i, y) {
      return i <= y;
    }
    function gte(i, y) {
      return i >= y;
    }
    function expand2(str, isTop) {
      var expansions = [];
      var m = balanced("{", "}", str);
      if (!m) return [str];
      var pre = m.pre;
      var post = m.post.length ? expand2(m.post, false) : [""];
      if (/\$$/.test(m.pre)) {
        for (var k = 0; k < post.length; k++) {
          var expansion = pre + "{" + m.body + "}" + post[k];
          expansions.push(expansion);
        }
      } else {
        var isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body);
        var isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body);
        var isSequence = isNumericSequence || isAlphaSequence;
        var isOptions = m.body.indexOf(",") >= 0;
        if (!isSequence && !isOptions) {
          if (m.post.match(/,(?!,).*\}/)) {
            str = m.pre + "{" + m.body + escClose + m.post;
            return expand2(str);
          }
          return [str];
        }
        var n;
        if (isSequence) {
          n = m.body.split(/\.\./);
        } else {
          n = parseCommaParts(m.body);
          if (n.length === 1) {
            n = expand2(n[0], false).map(embrace);
            if (n.length === 1) {
              return post.map(function(p) {
                return m.pre + n[0] + p;
              });
            }
          }
        }
        var N;
        if (isSequence) {
          var x = numeric(n[0]);
          var y = numeric(n[1]);
          var width = Math.max(n[0].length, n[1].length);
          var incr = n.length == 3 ? Math.abs(numeric(n[2])) : 1;
          var test = lte;
          var reverse = y < x;
          if (reverse) {
            incr *= -1;
            test = gte;
          }
          var pad = n.some(isPadded);
          N = [];
          for (var i = x; test(i, y); i += incr) {
            var c;
            if (isAlphaSequence) {
              c = String.fromCharCode(i);
              if (c === "\\")
                c = "";
            } else {
              c = String(i);
              if (pad) {
                var need = width - c.length;
                if (need > 0) {
                  var z = new Array(need + 1).join("0");
                  if (i < 0)
                    c = "-" + z + c.slice(1);
                  else
                    c = z + c;
                }
              }
            }
            N.push(c);
          }
        } else {
          N = [];
          for (var j = 0; j < n.length; j++) {
            N.push.apply(N, expand2(n[j], false));
          }
        }
        for (var j = 0; j < N.length; j++) {
          for (var k = 0; k < post.length; k++) {
            var expansion = pre + N[j] + post[k];
            if (!isTop || isSequence || expansion)
              expansions.push(expansion);
          }
        }
      }
      return expansions;
    }
  }
});

// ../../node_modules/ignore/index.js
var require_ignore = __commonJS({
  "../../node_modules/ignore/index.js"(exports, module) {
    "use strict";
    function makeArray(subject) {
      return Array.isArray(subject) ? subject : [subject];
    }
    var EMPTY = "";
    var SPACE = " ";
    var ESCAPE = "\\";
    var REGEX_TEST_BLANK_LINE = /^\s+$/;
    var REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
    var REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
    var REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
    var REGEX_SPLITALL_CRLF = /\r?\n/g;
    var REGEX_TEST_INVALID_PATH = /^\.*\/|^\.+$/;
    var SLASH = "/";
    var TMP_KEY_IGNORE = "node-ignore";
    if (typeof Symbol !== "undefined") {
      TMP_KEY_IGNORE = Symbol.for("node-ignore");
    }
    var KEY_IGNORE = TMP_KEY_IGNORE;
    var define = (object, key, value) => Object.defineProperty(object, key, { value });
    var REGEX_REGEXP_RANGE = /([0-z])-([0-z])/g;
    var RETURN_FALSE = () => false;
    var sanitizeRange = (range) => range.replace(
      REGEX_REGEXP_RANGE,
      (match2, from, to) => from.charCodeAt(0) <= to.charCodeAt(0) ? match2 : EMPTY
    );
    var cleanRangeBackSlash = (slashes) => {
      const { length } = slashes;
      return slashes.slice(0, length - length % 2);
    };
    var REPLACERS = [
      // > Trailing spaces are ignored unless they are quoted with backslash ("\")
      [
        // (a\ ) -> (a )
        // (a  ) -> (a)
        // (a \ ) -> (a  )
        /\\?\s+$/,
        (match2) => match2.indexOf("\\") === 0 ? SPACE : EMPTY
      ],
      // replace (\ ) with ' '
      [
        /\\\s/g,
        () => SPACE
      ],
      // Escape metacharacters
      // which is written down by users but means special for regular expressions.
      // > There are 12 characters with special meanings:
      // > - the backslash \,
      // > - the caret ^,
      // > - the dollar sign $,
      // > - the period or dot .,
      // > - the vertical bar or pipe symbol |,
      // > - the question mark ?,
      // > - the asterisk or star *,
      // > - the plus sign +,
      // > - the opening parenthesis (,
      // > - the closing parenthesis ),
      // > - and the opening square bracket [,
      // > - the opening curly brace {,
      // > These special characters are often called "metacharacters".
      [
        /[\\$.|*+(){^]/g,
        (match2) => `\\${match2}`
      ],
      [
        // > a question mark (?) matches a single character
        /(?!\\)\?/g,
        () => "[^/]"
      ],
      // leading slash
      [
        // > A leading slash matches the beginning of the pathname.
        // > For example, "/*.c" matches "cat-file.c" but not "mozilla-sha1/sha1.c".
        // A leading slash matches the beginning of the pathname
        /^\//,
        () => "^"
      ],
      // replace special metacharacter slash after the leading slash
      [
        /\//g,
        () => "\\/"
      ],
      [
        // > A leading "**" followed by a slash means match in all directories.
        // > For example, "**/foo" matches file or directory "foo" anywhere,
        // > the same as pattern "foo".
        // > "**/foo/bar" matches file or directory "bar" anywhere that is directly
        // >   under directory "foo".
        // Notice that the '*'s have been replaced as '\\*'
        /^\^*\\\*\\\*\\\//,
        // '**/foo' <-> 'foo'
        () => "^(?:.*\\/)?"
      ],
      // starting
      [
        // there will be no leading '/'
        //   (which has been replaced by section "leading slash")
        // If starts with '**', adding a '^' to the regular expression also works
        /^(?=[^^])/,
        function startingReplacer() {
          return !/\/(?!$)/.test(this) ? "(?:^|\\/)" : "^";
        }
      ],
      // two globstars
      [
        // Use lookahead assertions so that we could match more than one `'/**'`
        /\\\/\\\*\\\*(?=\\\/|$)/g,
        // Zero, one or several directories
        // should not use '*', or it will be replaced by the next replacer
        // Check if it is not the last `'/**'`
        (_, index, str) => index + 6 < str.length ? "(?:\\/[^\\/]+)*" : "\\/.+"
      ],
      // normal intermediate wildcards
      [
        // Never replace escaped '*'
        // ignore rule '\*' will match the path '*'
        // 'abc.*/' -> go
        // 'abc.*'  -> skip this rule,
        //    coz trailing single wildcard will be handed by [trailing wildcard]
        /(^|[^\\]+)(\\\*)+(?=.+)/g,
        // '*.js' matches '.js'
        // '*.js' doesn't match 'abc'
        (_, p1, p2) => {
          const unescaped = p2.replace(/\\\*/g, "[^\\/]*");
          return p1 + unescaped;
        }
      ],
      [
        // unescape, revert step 3 except for back slash
        // For example, if a user escape a '\\*',
        // after step 3, the result will be '\\\\\\*'
        /\\\\\\(?=[$.|*+(){^])/g,
        () => ESCAPE
      ],
      [
        // '\\\\' -> '\\'
        /\\\\/g,
        () => ESCAPE
      ],
      [
        // > The range notation, e.g. [a-zA-Z],
        // > can be used to match one of the characters in a range.
        // `\` is escaped by step 3
        /(\\)?\[([^\]/]*?)(\\*)($|\])/g,
        (match2, leadEscape, range, endEscape, close) => leadEscape === ESCAPE ? `\\[${range}${cleanRangeBackSlash(endEscape)}${close}` : close === "]" ? endEscape.length % 2 === 0 ? `[${sanitizeRange(range)}${endEscape}]` : "[]" : "[]"
      ],
      // ending
      [
        // 'js' will not match 'js.'
        // 'ab' will not match 'abc'
        /(?:[^*])$/,
        // WTF!
        // https://git-scm.com/docs/gitignore
        // changes in [2.22.1](https://git-scm.com/docs/gitignore/2.22.1)
        // which re-fixes #24, #38
        // > If there is a separator at the end of the pattern then the pattern
        // > will only match directories, otherwise the pattern can match both
        // > files and directories.
        // 'js*' will not match 'a.js'
        // 'js/' will not match 'a.js'
        // 'js' will match 'a.js' and 'a.js/'
        (match2) => /\/$/.test(match2) ? `${match2}$` : `${match2}(?=$|\\/$)`
      ],
      // trailing wildcard
      [
        /(\^|\\\/)?\\\*$/,
        (_, p1) => {
          const prefix = p1 ? `${p1}[^/]+` : "[^/]*";
          return `${prefix}(?=$|\\/$)`;
        }
      ]
    ];
    var regexCache = /* @__PURE__ */ Object.create(null);
    var makeRegex = (pattern, ignoreCase) => {
      let source = regexCache[pattern];
      if (!source) {
        source = REPLACERS.reduce(
          (prev, current) => prev.replace(current[0], current[1].bind(pattern)),
          pattern
        );
        regexCache[pattern] = source;
      }
      return ignoreCase ? new RegExp(source, "i") : new RegExp(source);
    };
    var isString = (subject) => typeof subject === "string";
    var checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_TEST_BLANK_LINE.test(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern) && pattern.indexOf("#") !== 0;
    var splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF);
    var IgnoreRule = class {
      constructor(origin, pattern, negative, regex) {
        this.origin = origin;
        this.pattern = pattern;
        this.negative = negative;
        this.regex = regex;
      }
    };
    var createRule = (pattern, ignoreCase) => {
      const origin = pattern;
      let negative = false;
      if (pattern.indexOf("!") === 0) {
        negative = true;
        pattern = pattern.substr(1);
      }
      pattern = pattern.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
      const regex = makeRegex(pattern, ignoreCase);
      return new IgnoreRule(
        origin,
        pattern,
        negative,
        regex
      );
    };
    var throwError = (message, Ctor) => {
      throw new Ctor(message);
    };
    var checkPath = (path13, originalPath, doThrow) => {
      if (!isString(path13)) {
        return doThrow(
          `path must be a string, but got \`${originalPath}\``,
          TypeError
        );
      }
      if (!path13) {
        return doThrow(`path must not be empty`, TypeError);
      }
      if (checkPath.isNotRelative(path13)) {
        const r = "`path.relative()`d";
        return doThrow(
          `path should be a ${r} string, but got "${originalPath}"`,
          RangeError
        );
      }
      return true;
    };
    var isNotRelative = (path13) => REGEX_TEST_INVALID_PATH.test(path13);
    checkPath.isNotRelative = isNotRelative;
    checkPath.convert = (p) => p;
    var Ignore2 = class {
      constructor({
        ignorecase = true,
        ignoreCase = ignorecase,
        allowRelativePaths = false
      } = {}) {
        define(this, KEY_IGNORE, true);
        this._rules = [];
        this._ignoreCase = ignoreCase;
        this._allowRelativePaths = allowRelativePaths;
        this._initCache();
      }
      _initCache() {
        this._ignoreCache = /* @__PURE__ */ Object.create(null);
        this._testCache = /* @__PURE__ */ Object.create(null);
      }
      _addPattern(pattern) {
        if (pattern && pattern[KEY_IGNORE]) {
          this._rules = this._rules.concat(pattern._rules);
          this._added = true;
          return;
        }
        if (checkPattern(pattern)) {
          const rule = createRule(pattern, this._ignoreCase);
          this._added = true;
          this._rules.push(rule);
        }
      }
      // @param {Array<string> | string | Ignore} pattern
      add(pattern) {
        this._added = false;
        makeArray(
          isString(pattern) ? splitPattern(pattern) : pattern
        ).forEach(this._addPattern, this);
        if (this._added) {
          this._initCache();
        }
        return this;
      }
      // legacy
      addPattern(pattern) {
        return this.add(pattern);
      }
      //          |           ignored : unignored
      // negative |   0:0   |   0:1   |   1:0   |   1:1
      // -------- | ------- | ------- | ------- | --------
      //     0    |  TEST   |  TEST   |  SKIP   |    X
      //     1    |  TESTIF |  SKIP   |  TEST   |    X
      // - SKIP: always skip
      // - TEST: always test
      // - TESTIF: only test if checkUnignored
      // - X: that never happen
      // @param {boolean} whether should check if the path is unignored,
      //   setting `checkUnignored` to `false` could reduce additional
      //   path matching.
      // @returns {TestResult} true if a file is ignored
      _testOne(path13, checkUnignored) {
        let ignored = false;
        let unignored = false;
        this._rules.forEach((rule) => {
          const { negative } = rule;
          if (unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored) {
            return;
          }
          const matched = rule.regex.test(path13);
          if (matched) {
            ignored = !negative;
            unignored = negative;
          }
        });
        return {
          ignored,
          unignored
        };
      }
      // @returns {TestResult}
      _test(originalPath, cache, checkUnignored, slices) {
        const path13 = originalPath && checkPath.convert(originalPath);
        checkPath(
          path13,
          originalPath,
          this._allowRelativePaths ? RETURN_FALSE : throwError
        );
        return this._t(path13, cache, checkUnignored, slices);
      }
      _t(path13, cache, checkUnignored, slices) {
        if (path13 in cache) {
          return cache[path13];
        }
        if (!slices) {
          slices = path13.split(SLASH);
        }
        slices.pop();
        if (!slices.length) {
          return cache[path13] = this._testOne(path13, checkUnignored);
        }
        const parent = this._t(
          slices.join(SLASH) + SLASH,
          cache,
          checkUnignored,
          slices
        );
        return cache[path13] = parent.ignored ? parent : this._testOne(path13, checkUnignored);
      }
      ignores(path13) {
        return this._test(path13, this._ignoreCache, false).ignored;
      }
      createFilter() {
        return (path13) => !this.ignores(path13);
      }
      filter(paths) {
        return makeArray(paths).filter(this.createFilter());
      }
      // @returns {TestResult}
      test(path13) {
        return this._test(path13, this._testCache, true);
      }
    };
    var factory = (options) => new Ignore2(options);
    var isPathValid = (path13) => checkPath(path13 && checkPath.convert(path13), path13, RETURN_FALSE);
    factory.isPathValid = isPathValid;
    factory.default = factory;
    module.exports = factory;
    if (
      // Detect `process` so that it can run in browsers.
      typeof process !== "undefined" && (process.env && process.env.IGNORE_TEST_WIN32 || process.platform === "win32")
    ) {
      const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
      checkPath.convert = makePosix;
      const REGIX_IS_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
      checkPath.isNotRelative = (path13) => REGIX_IS_WINDOWS_PATH_ABSOLUTE.test(path13) || isNotRelative(path13);
    }
  }
});

// src/index.ts
import * as core4 from "@actions/core";
import * as fs11 from "fs";
import { execSync } from "child_process";
import collect3 from "collect.js";

// ../core/dist/indexer/index.js
import fs10 from "fs/promises";

// ../../node_modules/yocto-queue/index.js
var Node = class {
  value;
  next;
  constructor(value) {
    this.value = value;
  }
};
var Queue = class {
  #head;
  #tail;
  #size;
  constructor() {
    this.clear();
  }
  enqueue(value) {
    const node = new Node(value);
    if (this.#head) {
      this.#tail.next = node;
      this.#tail = node;
    } else {
      this.#head = node;
      this.#tail = node;
    }
    this.#size++;
  }
  dequeue() {
    const current = this.#head;
    if (!current) {
      return;
    }
    this.#head = this.#head.next;
    this.#size--;
    if (!this.#head) {
      this.#tail = void 0;
    }
    return current.value;
  }
  peek() {
    if (!this.#head) {
      return;
    }
    return this.#head.value;
  }
  clear() {
    this.#head = void 0;
    this.#tail = void 0;
    this.#size = 0;
  }
  get size() {
    return this.#size;
  }
  *[Symbol.iterator]() {
    let current = this.#head;
    while (current) {
      yield current.value;
      current = current.next;
    }
  }
  *drain() {
    while (this.#head) {
      yield this.dequeue();
    }
  }
};

// ../../node_modules/p-limit/index.js
import { AsyncResource } from "async_hooks";
function pLimit(concurrency) {
  if (!((Number.isInteger(concurrency) || concurrency === Number.POSITIVE_INFINITY) && concurrency > 0)) {
    throw new TypeError("Expected `concurrency` to be a number from 1 and up");
  }
  const queue = new Queue();
  let activeCount = 0;
  const next = () => {
    activeCount--;
    if (queue.size > 0) {
      queue.dequeue()();
    }
  };
  const run2 = async (function_, resolve, arguments_) => {
    activeCount++;
    const result = (async () => function_(...arguments_))();
    resolve(result);
    try {
      await result;
    } catch {
    }
    next();
  };
  const enqueue = (function_, resolve, arguments_) => {
    queue.enqueue(
      AsyncResource.bind(run2.bind(void 0, function_, resolve, arguments_))
    );
    (async () => {
      await Promise.resolve();
      if (activeCount < concurrency && queue.size > 0) {
        queue.dequeue()();
      }
    })();
  };
  const generator = (function_, ...arguments_) => new Promise((resolve) => {
    enqueue(function_, resolve, arguments_);
  });
  Object.defineProperties(generator, {
    activeCount: {
      get: () => activeCount
    },
    pendingCount: {
      get: () => queue.size
    },
    clearQueue: {
      value() {
        queue.clear();
      }
    }
  });
  return generator;
}

// ../../node_modules/minimatch/dist/esm/index.js
var import_brace_expansion = __toESM(require_brace_expansion(), 1);

// ../../node_modules/minimatch/dist/esm/assert-valid-pattern.js
var MAX_PATTERN_LENGTH = 1024 * 64;
var assertValidPattern = (pattern) => {
  if (typeof pattern !== "string") {
    throw new TypeError("invalid pattern");
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new TypeError("pattern is too long");
  }
};

// ../../node_modules/minimatch/dist/esm/brace-expressions.js
var posixClasses = {
  "[:alnum:]": ["\\p{L}\\p{Nl}\\p{Nd}", true],
  "[:alpha:]": ["\\p{L}\\p{Nl}", true],
  "[:ascii:]": ["\\x00-\\x7f", false],
  "[:blank:]": ["\\p{Zs}\\t", true],
  "[:cntrl:]": ["\\p{Cc}", true],
  "[:digit:]": ["\\p{Nd}", true],
  "[:graph:]": ["\\p{Z}\\p{C}", true, true],
  "[:lower:]": ["\\p{Ll}", true],
  "[:print:]": ["\\p{C}", true],
  "[:punct:]": ["\\p{P}", true],
  "[:space:]": ["\\p{Z}\\t\\r\\n\\v\\f", true],
  "[:upper:]": ["\\p{Lu}", true],
  "[:word:]": ["\\p{L}\\p{Nl}\\p{Nd}\\p{Pc}", true],
  "[:xdigit:]": ["A-Fa-f0-9", false]
};
var braceEscape = (s) => s.replace(/[[\]\\-]/g, "\\$&");
var regexpEscape = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
var rangesToString = (ranges) => ranges.join("");
var parseClass = (glob2, position) => {
  const pos = position;
  if (glob2.charAt(pos) !== "[") {
    throw new Error("not in a brace expression");
  }
  const ranges = [];
  const negs = [];
  let i = pos + 1;
  let sawStart = false;
  let uflag = false;
  let escaping = false;
  let negate = false;
  let endPos = pos;
  let rangeStart = "";
  WHILE: while (i < glob2.length) {
    const c = glob2.charAt(i);
    if ((c === "!" || c === "^") && i === pos + 1) {
      negate = true;
      i++;
      continue;
    }
    if (c === "]" && sawStart && !escaping) {
      endPos = i + 1;
      break;
    }
    sawStart = true;
    if (c === "\\") {
      if (!escaping) {
        escaping = true;
        i++;
        continue;
      }
    }
    if (c === "[" && !escaping) {
      for (const [cls, [unip, u, neg]] of Object.entries(posixClasses)) {
        if (glob2.startsWith(cls, i)) {
          if (rangeStart) {
            return ["$.", false, glob2.length - pos, true];
          }
          i += cls.length;
          if (neg)
            negs.push(unip);
          else
            ranges.push(unip);
          uflag = uflag || u;
          continue WHILE;
        }
      }
    }
    escaping = false;
    if (rangeStart) {
      if (c > rangeStart) {
        ranges.push(braceEscape(rangeStart) + "-" + braceEscape(c));
      } else if (c === rangeStart) {
        ranges.push(braceEscape(c));
      }
      rangeStart = "";
      i++;
      continue;
    }
    if (glob2.startsWith("-]", i + 1)) {
      ranges.push(braceEscape(c + "-"));
      i += 2;
      continue;
    }
    if (glob2.startsWith("-", i + 1)) {
      rangeStart = c;
      i += 2;
      continue;
    }
    ranges.push(braceEscape(c));
    i++;
  }
  if (endPos < i) {
    return ["", false, 0, false];
  }
  if (!ranges.length && !negs.length) {
    return ["$.", false, glob2.length - pos, true];
  }
  if (negs.length === 0 && ranges.length === 1 && /^\\?.$/.test(ranges[0]) && !negate) {
    const r = ranges[0].length === 2 ? ranges[0].slice(-1) : ranges[0];
    return [regexpEscape(r), false, endPos - pos, false];
  }
  const sranges = "[" + (negate ? "^" : "") + rangesToString(ranges) + "]";
  const snegs = "[" + (negate ? "" : "^") + rangesToString(negs) + "]";
  const comb = ranges.length && negs.length ? "(" + sranges + "|" + snegs + ")" : ranges.length ? sranges : snegs;
  return [comb, uflag, endPos - pos, true];
};

// ../../node_modules/minimatch/dist/esm/unescape.js
var unescape = (s, { windowsPathsNoEscape = false } = {}) => {
  return windowsPathsNoEscape ? s.replace(/\[([^\/\\])\]/g, "$1") : s.replace(/((?!\\).|^)\[([^\/\\])\]/g, "$1$2").replace(/\\([^\/])/g, "$1");
};

// ../../node_modules/minimatch/dist/esm/ast.js
var types = /* @__PURE__ */ new Set(["!", "?", "+", "*", "@"]);
var isExtglobType = (c) => types.has(c);
var startNoTraversal = "(?!(?:^|/)\\.\\.?(?:$|/))";
var startNoDot = "(?!\\.)";
var addPatternStart = /* @__PURE__ */ new Set(["[", "."]);
var justDots = /* @__PURE__ */ new Set(["..", "."]);
var reSpecials = new Set("().*{}+?[]^$\\!");
var regExpEscape = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
var qmark = "[^/]";
var star = qmark + "*?";
var starNoEmpty = qmark + "+?";
var AST = class _AST {
  type;
  #root;
  #hasMagic;
  #uflag = false;
  #parts = [];
  #parent;
  #parentIndex;
  #negs;
  #filledNegs = false;
  #options;
  #toString;
  // set to true if it's an extglob with no children
  // (which really means one child of '')
  #emptyExt = false;
  constructor(type, parent, options = {}) {
    this.type = type;
    if (type)
      this.#hasMagic = true;
    this.#parent = parent;
    this.#root = this.#parent ? this.#parent.#root : this;
    this.#options = this.#root === this ? options : this.#root.#options;
    this.#negs = this.#root === this ? [] : this.#root.#negs;
    if (type === "!" && !this.#root.#filledNegs)
      this.#negs.push(this);
    this.#parentIndex = this.#parent ? this.#parent.#parts.length : 0;
  }
  get hasMagic() {
    if (this.#hasMagic !== void 0)
      return this.#hasMagic;
    for (const p of this.#parts) {
      if (typeof p === "string")
        continue;
      if (p.type || p.hasMagic)
        return this.#hasMagic = true;
    }
    return this.#hasMagic;
  }
  // reconstructs the pattern
  toString() {
    if (this.#toString !== void 0)
      return this.#toString;
    if (!this.type) {
      return this.#toString = this.#parts.map((p) => String(p)).join("");
    } else {
      return this.#toString = this.type + "(" + this.#parts.map((p) => String(p)).join("|") + ")";
    }
  }
  #fillNegs() {
    if (this !== this.#root)
      throw new Error("should only call on root");
    if (this.#filledNegs)
      return this;
    this.toString();
    this.#filledNegs = true;
    let n;
    while (n = this.#negs.pop()) {
      if (n.type !== "!")
        continue;
      let p = n;
      let pp = p.#parent;
      while (pp) {
        for (let i = p.#parentIndex + 1; !pp.type && i < pp.#parts.length; i++) {
          for (const part of n.#parts) {
            if (typeof part === "string") {
              throw new Error("string part in extglob AST??");
            }
            part.copyIn(pp.#parts[i]);
          }
        }
        p = pp;
        pp = p.#parent;
      }
    }
    return this;
  }
  push(...parts) {
    for (const p of parts) {
      if (p === "")
        continue;
      if (typeof p !== "string" && !(p instanceof _AST && p.#parent === this)) {
        throw new Error("invalid part: " + p);
      }
      this.#parts.push(p);
    }
  }
  toJSON() {
    const ret = this.type === null ? this.#parts.slice().map((p) => typeof p === "string" ? p : p.toJSON()) : [this.type, ...this.#parts.map((p) => p.toJSON())];
    if (this.isStart() && !this.type)
      ret.unshift([]);
    if (this.isEnd() && (this === this.#root || this.#root.#filledNegs && this.#parent?.type === "!")) {
      ret.push({});
    }
    return ret;
  }
  isStart() {
    if (this.#root === this)
      return true;
    if (!this.#parent?.isStart())
      return false;
    if (this.#parentIndex === 0)
      return true;
    const p = this.#parent;
    for (let i = 0; i < this.#parentIndex; i++) {
      const pp = p.#parts[i];
      if (!(pp instanceof _AST && pp.type === "!")) {
        return false;
      }
    }
    return true;
  }
  isEnd() {
    if (this.#root === this)
      return true;
    if (this.#parent?.type === "!")
      return true;
    if (!this.#parent?.isEnd())
      return false;
    if (!this.type)
      return this.#parent?.isEnd();
    const pl = this.#parent ? this.#parent.#parts.length : 0;
    return this.#parentIndex === pl - 1;
  }
  copyIn(part) {
    if (typeof part === "string")
      this.push(part);
    else
      this.push(part.clone(this));
  }
  clone(parent) {
    const c = new _AST(this.type, parent);
    for (const p of this.#parts) {
      c.copyIn(p);
    }
    return c;
  }
  static #parseAST(str, ast, pos, opt) {
    let escaping = false;
    let inBrace = false;
    let braceStart = -1;
    let braceNeg = false;
    if (ast.type === null) {
      let i2 = pos;
      let acc2 = "";
      while (i2 < str.length) {
        const c = str.charAt(i2++);
        if (escaping || c === "\\") {
          escaping = !escaping;
          acc2 += c;
          continue;
        }
        if (inBrace) {
          if (i2 === braceStart + 1) {
            if (c === "^" || c === "!") {
              braceNeg = true;
            }
          } else if (c === "]" && !(i2 === braceStart + 2 && braceNeg)) {
            inBrace = false;
          }
          acc2 += c;
          continue;
        } else if (c === "[") {
          inBrace = true;
          braceStart = i2;
          braceNeg = false;
          acc2 += c;
          continue;
        }
        if (!opt.noext && isExtglobType(c) && str.charAt(i2) === "(") {
          ast.push(acc2);
          acc2 = "";
          const ext2 = new _AST(c, ast);
          i2 = _AST.#parseAST(str, ext2, i2, opt);
          ast.push(ext2);
          continue;
        }
        acc2 += c;
      }
      ast.push(acc2);
      return i2;
    }
    let i = pos + 1;
    let part = new _AST(null, ast);
    const parts = [];
    let acc = "";
    while (i < str.length) {
      const c = str.charAt(i++);
      if (escaping || c === "\\") {
        escaping = !escaping;
        acc += c;
        continue;
      }
      if (inBrace) {
        if (i === braceStart + 1) {
          if (c === "^" || c === "!") {
            braceNeg = true;
          }
        } else if (c === "]" && !(i === braceStart + 2 && braceNeg)) {
          inBrace = false;
        }
        acc += c;
        continue;
      } else if (c === "[") {
        inBrace = true;
        braceStart = i;
        braceNeg = false;
        acc += c;
        continue;
      }
      if (isExtglobType(c) && str.charAt(i) === "(") {
        part.push(acc);
        acc = "";
        const ext2 = new _AST(c, part);
        part.push(ext2);
        i = _AST.#parseAST(str, ext2, i, opt);
        continue;
      }
      if (c === "|") {
        part.push(acc);
        acc = "";
        parts.push(part);
        part = new _AST(null, ast);
        continue;
      }
      if (c === ")") {
        if (acc === "" && ast.#parts.length === 0) {
          ast.#emptyExt = true;
        }
        part.push(acc);
        acc = "";
        ast.push(...parts, part);
        return i;
      }
      acc += c;
    }
    ast.type = null;
    ast.#hasMagic = void 0;
    ast.#parts = [str.substring(pos - 1)];
    return i;
  }
  static fromGlob(pattern, options = {}) {
    const ast = new _AST(null, void 0, options);
    _AST.#parseAST(pattern, ast, 0, options);
    return ast;
  }
  // returns the regular expression if there's magic, or the unescaped
  // string if not.
  toMMPattern() {
    if (this !== this.#root)
      return this.#root.toMMPattern();
    const glob2 = this.toString();
    const [re, body, hasMagic2, uflag] = this.toRegExpSource();
    const anyMagic = hasMagic2 || this.#hasMagic || this.#options.nocase && !this.#options.nocaseMagicOnly && glob2.toUpperCase() !== glob2.toLowerCase();
    if (!anyMagic) {
      return body;
    }
    const flags = (this.#options.nocase ? "i" : "") + (uflag ? "u" : "");
    return Object.assign(new RegExp(`^${re}$`, flags), {
      _src: re,
      _glob: glob2
    });
  }
  get options() {
    return this.#options;
  }
  // returns the string match, the regexp source, whether there's magic
  // in the regexp (so a regular expression is required) and whether or
  // not the uflag is needed for the regular expression (for posix classes)
  // TODO: instead of injecting the start/end at this point, just return
  // the BODY of the regexp, along with the start/end portions suitable
  // for binding the start/end in either a joined full-path makeRe context
  // (where we bind to (^|/), or a standalone matchPart context (where
  // we bind to ^, and not /).  Otherwise slashes get duped!
  //
  // In part-matching mode, the start is:
  // - if not isStart: nothing
  // - if traversal possible, but not allowed: ^(?!\.\.?$)
  // - if dots allowed or not possible: ^
  // - if dots possible and not allowed: ^(?!\.)
  // end is:
  // - if not isEnd(): nothing
  // - else: $
  //
  // In full-path matching mode, we put the slash at the START of the
  // pattern, so start is:
  // - if first pattern: same as part-matching mode
  // - if not isStart(): nothing
  // - if traversal possible, but not allowed: /(?!\.\.?(?:$|/))
  // - if dots allowed or not possible: /
  // - if dots possible and not allowed: /(?!\.)
  // end is:
  // - if last pattern, same as part-matching mode
  // - else nothing
  //
  // Always put the (?:$|/) on negated tails, though, because that has to be
  // there to bind the end of the negated pattern portion, and it's easier to
  // just stick it in now rather than try to inject it later in the middle of
  // the pattern.
  //
  // We can just always return the same end, and leave it up to the caller
  // to know whether it's going to be used joined or in parts.
  // And, if the start is adjusted slightly, can do the same there:
  // - if not isStart: nothing
  // - if traversal possible, but not allowed: (?:/|^)(?!\.\.?$)
  // - if dots allowed or not possible: (?:/|^)
  // - if dots possible and not allowed: (?:/|^)(?!\.)
  //
  // But it's better to have a simpler binding without a conditional, for
  // performance, so probably better to return both start options.
  //
  // Then the caller just ignores the end if it's not the first pattern,
  // and the start always gets applied.
  //
  // But that's always going to be $ if it's the ending pattern, or nothing,
  // so the caller can just attach $ at the end of the pattern when building.
  //
  // So the todo is:
  // - better detect what kind of start is needed
  // - return both flavors of starting pattern
  // - attach $ at the end of the pattern when creating the actual RegExp
  //
  // Ah, but wait, no, that all only applies to the root when the first pattern
  // is not an extglob. If the first pattern IS an extglob, then we need all
  // that dot prevention biz to live in the extglob portions, because eg
  // +(*|.x*) can match .xy but not .yx.
  //
  // So, return the two flavors if it's #root and the first child is not an
  // AST, otherwise leave it to the child AST to handle it, and there,
  // use the (?:^|/) style of start binding.
  //
  // Even simplified further:
  // - Since the start for a join is eg /(?!\.) and the start for a part
  // is ^(?!\.), we can just prepend (?!\.) to the pattern (either root
  // or start or whatever) and prepend ^ or / at the Regexp construction.
  toRegExpSource(allowDot) {
    const dot = allowDot ?? !!this.#options.dot;
    if (this.#root === this)
      this.#fillNegs();
    if (!this.type) {
      const noEmpty = this.isStart() && this.isEnd();
      const src = this.#parts.map((p) => {
        const [re, _, hasMagic2, uflag] = typeof p === "string" ? _AST.#parseGlob(p, this.#hasMagic, noEmpty) : p.toRegExpSource(allowDot);
        this.#hasMagic = this.#hasMagic || hasMagic2;
        this.#uflag = this.#uflag || uflag;
        return re;
      }).join("");
      let start2 = "";
      if (this.isStart()) {
        if (typeof this.#parts[0] === "string") {
          const dotTravAllowed = this.#parts.length === 1 && justDots.has(this.#parts[0]);
          if (!dotTravAllowed) {
            const aps = addPatternStart;
            const needNoTrav = (
              // dots are allowed, and the pattern starts with [ or .
              dot && aps.has(src.charAt(0)) || // the pattern starts with \., and then [ or .
              src.startsWith("\\.") && aps.has(src.charAt(2)) || // the pattern starts with \.\., and then [ or .
              src.startsWith("\\.\\.") && aps.has(src.charAt(4))
            );
            const needNoDot = !dot && !allowDot && aps.has(src.charAt(0));
            start2 = needNoTrav ? startNoTraversal : needNoDot ? startNoDot : "";
          }
        }
      }
      let end = "";
      if (this.isEnd() && this.#root.#filledNegs && this.#parent?.type === "!") {
        end = "(?:$|\\/)";
      }
      const final2 = start2 + src + end;
      return [
        final2,
        unescape(src),
        this.#hasMagic = !!this.#hasMagic,
        this.#uflag
      ];
    }
    const repeated = this.type === "*" || this.type === "+";
    const start = this.type === "!" ? "(?:(?!(?:" : "(?:";
    let body = this.#partsToRegExp(dot);
    if (this.isStart() && this.isEnd() && !body && this.type !== "!") {
      const s = this.toString();
      this.#parts = [s];
      this.type = null;
      this.#hasMagic = void 0;
      return [s, unescape(this.toString()), false, false];
    }
    let bodyDotAllowed = !repeated || allowDot || dot || !startNoDot ? "" : this.#partsToRegExp(true);
    if (bodyDotAllowed === body) {
      bodyDotAllowed = "";
    }
    if (bodyDotAllowed) {
      body = `(?:${body})(?:${bodyDotAllowed})*?`;
    }
    let final = "";
    if (this.type === "!" && this.#emptyExt) {
      final = (this.isStart() && !dot ? startNoDot : "") + starNoEmpty;
    } else {
      const close = this.type === "!" ? (
        // !() must match something,but !(x) can match ''
        "))" + (this.isStart() && !dot && !allowDot ? startNoDot : "") + star + ")"
      ) : this.type === "@" ? ")" : this.type === "?" ? ")?" : this.type === "+" && bodyDotAllowed ? ")" : this.type === "*" && bodyDotAllowed ? `)?` : `)${this.type}`;
      final = start + body + close;
    }
    return [
      final,
      unescape(body),
      this.#hasMagic = !!this.#hasMagic,
      this.#uflag
    ];
  }
  #partsToRegExp(dot) {
    return this.#parts.map((p) => {
      if (typeof p === "string") {
        throw new Error("string type in extglob ast??");
      }
      const [re, _, _hasMagic, uflag] = p.toRegExpSource(dot);
      this.#uflag = this.#uflag || uflag;
      return re;
    }).filter((p) => !(this.isStart() && this.isEnd()) || !!p).join("|");
  }
  static #parseGlob(glob2, hasMagic2, noEmpty = false) {
    let escaping = false;
    let re = "";
    let uflag = false;
    for (let i = 0; i < glob2.length; i++) {
      const c = glob2.charAt(i);
      if (escaping) {
        escaping = false;
        re += (reSpecials.has(c) ? "\\" : "") + c;
        continue;
      }
      if (c === "\\") {
        if (i === glob2.length - 1) {
          re += "\\\\";
        } else {
          escaping = true;
        }
        continue;
      }
      if (c === "[") {
        const [src, needUflag, consumed, magic] = parseClass(glob2, i);
        if (consumed) {
          re += src;
          uflag = uflag || needUflag;
          i += consumed - 1;
          hasMagic2 = hasMagic2 || magic;
          continue;
        }
      }
      if (c === "*") {
        if (noEmpty && glob2 === "*")
          re += starNoEmpty;
        else
          re += star;
        hasMagic2 = true;
        continue;
      }
      if (c === "?") {
        re += qmark;
        hasMagic2 = true;
        continue;
      }
      re += regExpEscape(c);
    }
    return [re, unescape(glob2), !!hasMagic2, uflag];
  }
};

// ../../node_modules/minimatch/dist/esm/escape.js
var escape = (s, { windowsPathsNoEscape = false } = {}) => {
  return windowsPathsNoEscape ? s.replace(/[?*()[\]]/g, "[$&]") : s.replace(/[?*()[\]\\]/g, "\\$&");
};

// ../../node_modules/minimatch/dist/esm/index.js
var minimatch = (p, pattern, options = {}) => {
  assertValidPattern(pattern);
  if (!options.nocomment && pattern.charAt(0) === "#") {
    return false;
  }
  return new Minimatch(pattern, options).match(p);
};
var starDotExtRE = /^\*+([^+@!?\*\[\(]*)$/;
var starDotExtTest = (ext2) => (f) => !f.startsWith(".") && f.endsWith(ext2);
var starDotExtTestDot = (ext2) => (f) => f.endsWith(ext2);
var starDotExtTestNocase = (ext2) => {
  ext2 = ext2.toLowerCase();
  return (f) => !f.startsWith(".") && f.toLowerCase().endsWith(ext2);
};
var starDotExtTestNocaseDot = (ext2) => {
  ext2 = ext2.toLowerCase();
  return (f) => f.toLowerCase().endsWith(ext2);
};
var starDotStarRE = /^\*+\.\*+$/;
var starDotStarTest = (f) => !f.startsWith(".") && f.includes(".");
var starDotStarTestDot = (f) => f !== "." && f !== ".." && f.includes(".");
var dotStarRE = /^\.\*+$/;
var dotStarTest = (f) => f !== "." && f !== ".." && f.startsWith(".");
var starRE = /^\*+$/;
var starTest = (f) => f.length !== 0 && !f.startsWith(".");
var starTestDot = (f) => f.length !== 0 && f !== "." && f !== "..";
var qmarksRE = /^\?+([^+@!?\*\[\(]*)?$/;
var qmarksTestNocase = ([$0, ext2 = ""]) => {
  const noext = qmarksTestNoExt([$0]);
  if (!ext2)
    return noext;
  ext2 = ext2.toLowerCase();
  return (f) => noext(f) && f.toLowerCase().endsWith(ext2);
};
var qmarksTestNocaseDot = ([$0, ext2 = ""]) => {
  const noext = qmarksTestNoExtDot([$0]);
  if (!ext2)
    return noext;
  ext2 = ext2.toLowerCase();
  return (f) => noext(f) && f.toLowerCase().endsWith(ext2);
};
var qmarksTestDot = ([$0, ext2 = ""]) => {
  const noext = qmarksTestNoExtDot([$0]);
  return !ext2 ? noext : (f) => noext(f) && f.endsWith(ext2);
};
var qmarksTest = ([$0, ext2 = ""]) => {
  const noext = qmarksTestNoExt([$0]);
  return !ext2 ? noext : (f) => noext(f) && f.endsWith(ext2);
};
var qmarksTestNoExt = ([$0]) => {
  const len = $0.length;
  return (f) => f.length === len && !f.startsWith(".");
};
var qmarksTestNoExtDot = ([$0]) => {
  const len = $0.length;
  return (f) => f.length === len && f !== "." && f !== "..";
};
var defaultPlatform = typeof process === "object" && process ? typeof process.env === "object" && process.env && process.env.__MINIMATCH_TESTING_PLATFORM__ || process.platform : "posix";
var path = {
  win32: { sep: "\\" },
  posix: { sep: "/" }
};
var sep = defaultPlatform === "win32" ? path.win32.sep : path.posix.sep;
minimatch.sep = sep;
var GLOBSTAR = Symbol("globstar **");
minimatch.GLOBSTAR = GLOBSTAR;
var qmark2 = "[^/]";
var star2 = qmark2 + "*?";
var twoStarDot = "(?:(?!(?:\\/|^)(?:\\.{1,2})($|\\/)).)*?";
var twoStarNoDot = "(?:(?!(?:\\/|^)\\.).)*?";
var filter = (pattern, options = {}) => (p) => minimatch(p, pattern, options);
minimatch.filter = filter;
var ext = (a, b = {}) => Object.assign({}, a, b);
var defaults = (def) => {
  if (!def || typeof def !== "object" || !Object.keys(def).length) {
    return minimatch;
  }
  const orig = minimatch;
  const m = (p, pattern, options = {}) => orig(p, pattern, ext(def, options));
  return Object.assign(m, {
    Minimatch: class Minimatch extends orig.Minimatch {
      constructor(pattern, options = {}) {
        super(pattern, ext(def, options));
      }
      static defaults(options) {
        return orig.defaults(ext(def, options)).Minimatch;
      }
    },
    AST: class AST extends orig.AST {
      /* c8 ignore start */
      constructor(type, parent, options = {}) {
        super(type, parent, ext(def, options));
      }
      /* c8 ignore stop */
      static fromGlob(pattern, options = {}) {
        return orig.AST.fromGlob(pattern, ext(def, options));
      }
    },
    unescape: (s, options = {}) => orig.unescape(s, ext(def, options)),
    escape: (s, options = {}) => orig.escape(s, ext(def, options)),
    filter: (pattern, options = {}) => orig.filter(pattern, ext(def, options)),
    defaults: (options) => orig.defaults(ext(def, options)),
    makeRe: (pattern, options = {}) => orig.makeRe(pattern, ext(def, options)),
    braceExpand: (pattern, options = {}) => orig.braceExpand(pattern, ext(def, options)),
    match: (list, pattern, options = {}) => orig.match(list, pattern, ext(def, options)),
    sep: orig.sep,
    GLOBSTAR
  });
};
minimatch.defaults = defaults;
var braceExpand = (pattern, options = {}) => {
  assertValidPattern(pattern);
  if (options.nobrace || !/\{(?:(?!\{).)*\}/.test(pattern)) {
    return [pattern];
  }
  return (0, import_brace_expansion.default)(pattern);
};
minimatch.braceExpand = braceExpand;
var makeRe = (pattern, options = {}) => new Minimatch(pattern, options).makeRe();
minimatch.makeRe = makeRe;
var match = (list, pattern, options = {}) => {
  const mm = new Minimatch(pattern, options);
  list = list.filter((f) => mm.match(f));
  if (mm.options.nonull && !list.length) {
    list.push(pattern);
  }
  return list;
};
minimatch.match = match;
var globMagic = /[?*]|[+@!]\(.*?\)|\[|\]/;
var regExpEscape2 = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
var Minimatch = class {
  options;
  set;
  pattern;
  windowsPathsNoEscape;
  nonegate;
  negate;
  comment;
  empty;
  preserveMultipleSlashes;
  partial;
  globSet;
  globParts;
  nocase;
  isWindows;
  platform;
  windowsNoMagicRoot;
  regexp;
  constructor(pattern, options = {}) {
    assertValidPattern(pattern);
    options = options || {};
    this.options = options;
    this.pattern = pattern;
    this.platform = options.platform || defaultPlatform;
    this.isWindows = this.platform === "win32";
    this.windowsPathsNoEscape = !!options.windowsPathsNoEscape || options.allowWindowsEscape === false;
    if (this.windowsPathsNoEscape) {
      this.pattern = this.pattern.replace(/\\/g, "/");
    }
    this.preserveMultipleSlashes = !!options.preserveMultipleSlashes;
    this.regexp = null;
    this.negate = false;
    this.nonegate = !!options.nonegate;
    this.comment = false;
    this.empty = false;
    this.partial = !!options.partial;
    this.nocase = !!this.options.nocase;
    this.windowsNoMagicRoot = options.windowsNoMagicRoot !== void 0 ? options.windowsNoMagicRoot : !!(this.isWindows && this.nocase);
    this.globSet = [];
    this.globParts = [];
    this.set = [];
    this.make();
  }
  hasMagic() {
    if (this.options.magicalBraces && this.set.length > 1) {
      return true;
    }
    for (const pattern of this.set) {
      for (const part of pattern) {
        if (typeof part !== "string")
          return true;
      }
    }
    return false;
  }
  debug(..._) {
  }
  make() {
    const pattern = this.pattern;
    const options = this.options;
    if (!options.nocomment && pattern.charAt(0) === "#") {
      this.comment = true;
      return;
    }
    if (!pattern) {
      this.empty = true;
      return;
    }
    this.parseNegate();
    this.globSet = [...new Set(this.braceExpand())];
    if (options.debug) {
      this.debug = (...args) => console.error(...args);
    }
    this.debug(this.pattern, this.globSet);
    const rawGlobParts = this.globSet.map((s) => this.slashSplit(s));
    this.globParts = this.preprocess(rawGlobParts);
    this.debug(this.pattern, this.globParts);
    let set = this.globParts.map((s, _, __) => {
      if (this.isWindows && this.windowsNoMagicRoot) {
        const isUNC = s[0] === "" && s[1] === "" && (s[2] === "?" || !globMagic.test(s[2])) && !globMagic.test(s[3]);
        const isDrive = /^[a-z]:/i.test(s[0]);
        if (isUNC) {
          return [...s.slice(0, 4), ...s.slice(4).map((ss) => this.parse(ss))];
        } else if (isDrive) {
          return [s[0], ...s.slice(1).map((ss) => this.parse(ss))];
        }
      }
      return s.map((ss) => this.parse(ss));
    });
    this.debug(this.pattern, set);
    this.set = set.filter((s) => s.indexOf(false) === -1);
    if (this.isWindows) {
      for (let i = 0; i < this.set.length; i++) {
        const p = this.set[i];
        if (p[0] === "" && p[1] === "" && this.globParts[i][2] === "?" && typeof p[3] === "string" && /^[a-z]:$/i.test(p[3])) {
          p[2] = "?";
        }
      }
    }
    this.debug(this.pattern, this.set);
  }
  // various transforms to equivalent pattern sets that are
  // faster to process in a filesystem walk.  The goal is to
  // eliminate what we can, and push all ** patterns as far
  // to the right as possible, even if it increases the number
  // of patterns that we have to process.
  preprocess(globParts) {
    if (this.options.noglobstar) {
      for (let i = 0; i < globParts.length; i++) {
        for (let j = 0; j < globParts[i].length; j++) {
          if (globParts[i][j] === "**") {
            globParts[i][j] = "*";
          }
        }
      }
    }
    const { optimizationLevel = 1 } = this.options;
    if (optimizationLevel >= 2) {
      globParts = this.firstPhasePreProcess(globParts);
      globParts = this.secondPhasePreProcess(globParts);
    } else if (optimizationLevel >= 1) {
      globParts = this.levelOneOptimize(globParts);
    } else {
      globParts = this.adjascentGlobstarOptimize(globParts);
    }
    return globParts;
  }
  // just get rid of adjascent ** portions
  adjascentGlobstarOptimize(globParts) {
    return globParts.map((parts) => {
      let gs = -1;
      while (-1 !== (gs = parts.indexOf("**", gs + 1))) {
        let i = gs;
        while (parts[i + 1] === "**") {
          i++;
        }
        if (i !== gs) {
          parts.splice(gs, i - gs);
        }
      }
      return parts;
    });
  }
  // get rid of adjascent ** and resolve .. portions
  levelOneOptimize(globParts) {
    return globParts.map((parts) => {
      parts = parts.reduce((set, part) => {
        const prev = set[set.length - 1];
        if (part === "**" && prev === "**") {
          return set;
        }
        if (part === "..") {
          if (prev && prev !== ".." && prev !== "." && prev !== "**") {
            set.pop();
            return set;
          }
        }
        set.push(part);
        return set;
      }, []);
      return parts.length === 0 ? [""] : parts;
    });
  }
  levelTwoFileOptimize(parts) {
    if (!Array.isArray(parts)) {
      parts = this.slashSplit(parts);
    }
    let didSomething = false;
    do {
      didSomething = false;
      if (!this.preserveMultipleSlashes) {
        for (let i = 1; i < parts.length - 1; i++) {
          const p = parts[i];
          if (i === 1 && p === "" && parts[0] === "")
            continue;
          if (p === "." || p === "") {
            didSomething = true;
            parts.splice(i, 1);
            i--;
          }
        }
        if (parts[0] === "." && parts.length === 2 && (parts[1] === "." || parts[1] === "")) {
          didSomething = true;
          parts.pop();
        }
      }
      let dd = 0;
      while (-1 !== (dd = parts.indexOf("..", dd + 1))) {
        const p = parts[dd - 1];
        if (p && p !== "." && p !== ".." && p !== "**") {
          didSomething = true;
          parts.splice(dd - 1, 2);
          dd -= 2;
        }
      }
    } while (didSomething);
    return parts.length === 0 ? [""] : parts;
  }
  // First phase: single-pattern processing
  // <pre> is 1 or more portions
  // <rest> is 1 or more portions
  // <p> is any portion other than ., .., '', or **
  // <e> is . or ''
  //
  // **/.. is *brutal* for filesystem walking performance, because
  // it effectively resets the recursive walk each time it occurs,
  // and ** cannot be reduced out by a .. pattern part like a regexp
  // or most strings (other than .., ., and '') can be.
  //
  // <pre>/**/../<p>/<p>/<rest> -> {<pre>/../<p>/<p>/<rest>,<pre>/**/<p>/<p>/<rest>}
  // <pre>/<e>/<rest> -> <pre>/<rest>
  // <pre>/<p>/../<rest> -> <pre>/<rest>
  // **/**/<rest> -> **/<rest>
  //
  // **/*/<rest> -> */**/<rest> <== not valid because ** doesn't follow
  // this WOULD be allowed if ** did follow symlinks, or * didn't
  firstPhasePreProcess(globParts) {
    let didSomething = false;
    do {
      didSomething = false;
      for (let parts of globParts) {
        let gs = -1;
        while (-1 !== (gs = parts.indexOf("**", gs + 1))) {
          let gss = gs;
          while (parts[gss + 1] === "**") {
            gss++;
          }
          if (gss > gs) {
            parts.splice(gs + 1, gss - gs);
          }
          let next = parts[gs + 1];
          const p = parts[gs + 2];
          const p2 = parts[gs + 3];
          if (next !== "..")
            continue;
          if (!p || p === "." || p === ".." || !p2 || p2 === "." || p2 === "..") {
            continue;
          }
          didSomething = true;
          parts.splice(gs, 1);
          const other = parts.slice(0);
          other[gs] = "**";
          globParts.push(other);
          gs--;
        }
        if (!this.preserveMultipleSlashes) {
          for (let i = 1; i < parts.length - 1; i++) {
            const p = parts[i];
            if (i === 1 && p === "" && parts[0] === "")
              continue;
            if (p === "." || p === "") {
              didSomething = true;
              parts.splice(i, 1);
              i--;
            }
          }
          if (parts[0] === "." && parts.length === 2 && (parts[1] === "." || parts[1] === "")) {
            didSomething = true;
            parts.pop();
          }
        }
        let dd = 0;
        while (-1 !== (dd = parts.indexOf("..", dd + 1))) {
          const p = parts[dd - 1];
          if (p && p !== "." && p !== ".." && p !== "**") {
            didSomething = true;
            const needDot = dd === 1 && parts[dd + 1] === "**";
            const splin = needDot ? ["."] : [];
            parts.splice(dd - 1, 2, ...splin);
            if (parts.length === 0)
              parts.push("");
            dd -= 2;
          }
        }
      }
    } while (didSomething);
    return globParts;
  }
  // second phase: multi-pattern dedupes
  // {<pre>/*/<rest>,<pre>/<p>/<rest>} -> <pre>/*/<rest>
  // {<pre>/<rest>,<pre>/<rest>} -> <pre>/<rest>
  // {<pre>/**/<rest>,<pre>/<rest>} -> <pre>/**/<rest>
  //
  // {<pre>/**/<rest>,<pre>/**/<p>/<rest>} -> <pre>/**/<rest>
  // ^-- not valid because ** doens't follow symlinks
  secondPhasePreProcess(globParts) {
    for (let i = 0; i < globParts.length - 1; i++) {
      for (let j = i + 1; j < globParts.length; j++) {
        const matched = this.partsMatch(globParts[i], globParts[j], !this.preserveMultipleSlashes);
        if (matched) {
          globParts[i] = [];
          globParts[j] = matched;
          break;
        }
      }
    }
    return globParts.filter((gs) => gs.length);
  }
  partsMatch(a, b, emptyGSMatch = false) {
    let ai = 0;
    let bi = 0;
    let result = [];
    let which = "";
    while (ai < a.length && bi < b.length) {
      if (a[ai] === b[bi]) {
        result.push(which === "b" ? b[bi] : a[ai]);
        ai++;
        bi++;
      } else if (emptyGSMatch && a[ai] === "**" && b[bi] === a[ai + 1]) {
        result.push(a[ai]);
        ai++;
      } else if (emptyGSMatch && b[bi] === "**" && a[ai] === b[bi + 1]) {
        result.push(b[bi]);
        bi++;
      } else if (a[ai] === "*" && b[bi] && (this.options.dot || !b[bi].startsWith(".")) && b[bi] !== "**") {
        if (which === "b")
          return false;
        which = "a";
        result.push(a[ai]);
        ai++;
        bi++;
      } else if (b[bi] === "*" && a[ai] && (this.options.dot || !a[ai].startsWith(".")) && a[ai] !== "**") {
        if (which === "a")
          return false;
        which = "b";
        result.push(b[bi]);
        ai++;
        bi++;
      } else {
        return false;
      }
    }
    return a.length === b.length && result;
  }
  parseNegate() {
    if (this.nonegate)
      return;
    const pattern = this.pattern;
    let negate = false;
    let negateOffset = 0;
    for (let i = 0; i < pattern.length && pattern.charAt(i) === "!"; i++) {
      negate = !negate;
      negateOffset++;
    }
    if (negateOffset)
      this.pattern = pattern.slice(negateOffset);
    this.negate = negate;
  }
  // set partial to true to test if, for example,
  // "/a/b" matches the start of "/*/b/*/d"
  // Partial means, if you run out of file before you run
  // out of pattern, then that's fine, as long as all
  // the parts match.
  matchOne(file, pattern, partial = false) {
    const options = this.options;
    if (this.isWindows) {
      const fileDrive = typeof file[0] === "string" && /^[a-z]:$/i.test(file[0]);
      const fileUNC = !fileDrive && file[0] === "" && file[1] === "" && file[2] === "?" && /^[a-z]:$/i.test(file[3]);
      const patternDrive = typeof pattern[0] === "string" && /^[a-z]:$/i.test(pattern[0]);
      const patternUNC = !patternDrive && pattern[0] === "" && pattern[1] === "" && pattern[2] === "?" && typeof pattern[3] === "string" && /^[a-z]:$/i.test(pattern[3]);
      const fdi = fileUNC ? 3 : fileDrive ? 0 : void 0;
      const pdi = patternUNC ? 3 : patternDrive ? 0 : void 0;
      if (typeof fdi === "number" && typeof pdi === "number") {
        const [fd, pd] = [file[fdi], pattern[pdi]];
        if (fd.toLowerCase() === pd.toLowerCase()) {
          pattern[pdi] = fd;
          if (pdi > fdi) {
            pattern = pattern.slice(pdi);
          } else if (fdi > pdi) {
            file = file.slice(fdi);
          }
        }
      }
    }
    const { optimizationLevel = 1 } = this.options;
    if (optimizationLevel >= 2) {
      file = this.levelTwoFileOptimize(file);
    }
    this.debug("matchOne", this, { file, pattern });
    this.debug("matchOne", file.length, pattern.length);
    for (var fi = 0, pi = 0, fl = file.length, pl = pattern.length; fi < fl && pi < pl; fi++, pi++) {
      this.debug("matchOne loop");
      var p = pattern[pi];
      var f = file[fi];
      this.debug(pattern, p, f);
      if (p === false) {
        return false;
      }
      if (p === GLOBSTAR) {
        this.debug("GLOBSTAR", [pattern, p, f]);
        var fr = fi;
        var pr = pi + 1;
        if (pr === pl) {
          this.debug("** at the end");
          for (; fi < fl; fi++) {
            if (file[fi] === "." || file[fi] === ".." || !options.dot && file[fi].charAt(0) === ".")
              return false;
          }
          return true;
        }
        while (fr < fl) {
          var swallowee = file[fr];
          this.debug("\nglobstar while", file, fr, pattern, pr, swallowee);
          if (this.matchOne(file.slice(fr), pattern.slice(pr), partial)) {
            this.debug("globstar found match!", fr, fl, swallowee);
            return true;
          } else {
            if (swallowee === "." || swallowee === ".." || !options.dot && swallowee.charAt(0) === ".") {
              this.debug("dot detected!", file, fr, pattern, pr);
              break;
            }
            this.debug("globstar swallow a segment, and continue");
            fr++;
          }
        }
        if (partial) {
          this.debug("\n>>> no match, partial?", file, fr, pattern, pr);
          if (fr === fl) {
            return true;
          }
        }
        return false;
      }
      let hit;
      if (typeof p === "string") {
        hit = f === p;
        this.debug("string match", p, f, hit);
      } else {
        hit = p.test(f);
        this.debug("pattern match", p, f, hit);
      }
      if (!hit)
        return false;
    }
    if (fi === fl && pi === pl) {
      return true;
    } else if (fi === fl) {
      return partial;
    } else if (pi === pl) {
      return fi === fl - 1 && file[fi] === "";
    } else {
      throw new Error("wtf?");
    }
  }
  braceExpand() {
    return braceExpand(this.pattern, this.options);
  }
  parse(pattern) {
    assertValidPattern(pattern);
    const options = this.options;
    if (pattern === "**")
      return GLOBSTAR;
    if (pattern === "")
      return "";
    let m;
    let fastTest = null;
    if (m = pattern.match(starRE)) {
      fastTest = options.dot ? starTestDot : starTest;
    } else if (m = pattern.match(starDotExtRE)) {
      fastTest = (options.nocase ? options.dot ? starDotExtTestNocaseDot : starDotExtTestNocase : options.dot ? starDotExtTestDot : starDotExtTest)(m[1]);
    } else if (m = pattern.match(qmarksRE)) {
      fastTest = (options.nocase ? options.dot ? qmarksTestNocaseDot : qmarksTestNocase : options.dot ? qmarksTestDot : qmarksTest)(m);
    } else if (m = pattern.match(starDotStarRE)) {
      fastTest = options.dot ? starDotStarTestDot : starDotStarTest;
    } else if (m = pattern.match(dotStarRE)) {
      fastTest = dotStarTest;
    }
    const re = AST.fromGlob(pattern, this.options).toMMPattern();
    if (fastTest && typeof re === "object") {
      Reflect.defineProperty(re, "test", { value: fastTest });
    }
    return re;
  }
  makeRe() {
    if (this.regexp || this.regexp === false)
      return this.regexp;
    const set = this.set;
    if (!set.length) {
      this.regexp = false;
      return this.regexp;
    }
    const options = this.options;
    const twoStar = options.noglobstar ? star2 : options.dot ? twoStarDot : twoStarNoDot;
    const flags = new Set(options.nocase ? ["i"] : []);
    let re = set.map((pattern) => {
      const pp = pattern.map((p) => {
        if (p instanceof RegExp) {
          for (const f of p.flags.split(""))
            flags.add(f);
        }
        return typeof p === "string" ? regExpEscape2(p) : p === GLOBSTAR ? GLOBSTAR : p._src;
      });
      pp.forEach((p, i) => {
        const next = pp[i + 1];
        const prev = pp[i - 1];
        if (p !== GLOBSTAR || prev === GLOBSTAR) {
          return;
        }
        if (prev === void 0) {
          if (next !== void 0 && next !== GLOBSTAR) {
            pp[i + 1] = "(?:\\/|" + twoStar + "\\/)?" + next;
          } else {
            pp[i] = twoStar;
          }
        } else if (next === void 0) {
          pp[i - 1] = prev + "(?:\\/|" + twoStar + ")?";
        } else if (next !== GLOBSTAR) {
          pp[i - 1] = prev + "(?:\\/|\\/" + twoStar + "\\/)" + next;
          pp[i + 1] = GLOBSTAR;
        }
      });
      return pp.filter((p) => p !== GLOBSTAR).join("/");
    }).join("|");
    const [open, close] = set.length > 1 ? ["(?:", ")"] : ["", ""];
    re = "^" + open + re + close + "$";
    if (this.negate)
      re = "^(?!" + re + ").+$";
    try {
      this.regexp = new RegExp(re, [...flags].join(""));
    } catch (ex) {
      this.regexp = false;
    }
    return this.regexp;
  }
  slashSplit(p) {
    if (this.preserveMultipleSlashes) {
      return p.split("/");
    } else if (this.isWindows && /^\/\/[^\/]+/.test(p)) {
      return ["", ...p.split(/\/+/)];
    } else {
      return p.split(/\/+/);
    }
  }
  match(f, partial = this.partial) {
    this.debug("match", f, this.pattern);
    if (this.comment) {
      return false;
    }
    if (this.empty) {
      return f === "";
    }
    if (f === "/" && partial) {
      return true;
    }
    const options = this.options;
    if (this.isWindows) {
      f = f.split("\\").join("/");
    }
    const ff = this.slashSplit(f);
    this.debug(this.pattern, "split", ff);
    const set = this.set;
    this.debug(this.pattern, "set", set);
    let filename = ff[ff.length - 1];
    if (!filename) {
      for (let i = ff.length - 2; !filename && i >= 0; i--) {
        filename = ff[i];
      }
    }
    for (let i = 0; i < set.length; i++) {
      const pattern = set[i];
      let file = ff;
      if (options.matchBase && pattern.length === 1) {
        file = [filename];
      }
      const hit = this.matchOne(file, pattern, partial);
      if (hit) {
        if (options.flipNegate) {
          return true;
        }
        return !this.negate;
      }
    }
    if (options.flipNegate) {
      return false;
    }
    return this.negate;
  }
  static defaults(def) {
    return minimatch.defaults(def).Minimatch;
  }
};
minimatch.AST = AST;
minimatch.Minimatch = Minimatch;
minimatch.escape = escape;
minimatch.unescape = unescape;

// ../../node_modules/lru-cache/dist/esm/index.js
var perf = typeof performance === "object" && performance && typeof performance.now === "function" ? performance : Date;
var warned = /* @__PURE__ */ new Set();
var PROCESS = typeof process === "object" && !!process ? process : {};
var emitWarning = (msg, type, code, fn) => {
  typeof PROCESS.emitWarning === "function" ? PROCESS.emitWarning(msg, type, code, fn) : console.error(`[${code}] ${type}: ${msg}`);
};
var AC = globalThis.AbortController;
var AS = globalThis.AbortSignal;
if (typeof AC === "undefined") {
  AS = class AbortSignal {
    onabort;
    _onabort = [];
    reason;
    aborted = false;
    addEventListener(_, fn) {
      this._onabort.push(fn);
    }
  };
  AC = class AbortController {
    constructor() {
      warnACPolyfill();
    }
    signal = new AS();
    abort(reason) {
      if (this.signal.aborted)
        return;
      this.signal.reason = reason;
      this.signal.aborted = true;
      for (const fn of this.signal._onabort) {
        fn(reason);
      }
      this.signal.onabort?.(reason);
    }
  };
  let printACPolyfillWarning = PROCESS.env?.LRU_CACHE_IGNORE_AC_WARNING !== "1";
  const warnACPolyfill = () => {
    if (!printACPolyfillWarning)
      return;
    printACPolyfillWarning = false;
    emitWarning("AbortController is not defined. If using lru-cache in node 14, load an AbortController polyfill from the `node-abort-controller` package. A minimal polyfill is provided for use by LRUCache.fetch(), but it should not be relied upon in other contexts (eg, passing it to other APIs that use AbortController/AbortSignal might have undesirable effects). You may disable this with LRU_CACHE_IGNORE_AC_WARNING=1 in the env.", "NO_ABORT_CONTROLLER", "ENOTSUP", warnACPolyfill);
  };
}
var shouldWarn = (code) => !warned.has(code);
var TYPE = Symbol("type");
var isPosInt = (n) => n && n === Math.floor(n) && n > 0 && isFinite(n);
var getUintArray = (max) => !isPosInt(max) ? null : max <= Math.pow(2, 8) ? Uint8Array : max <= Math.pow(2, 16) ? Uint16Array : max <= Math.pow(2, 32) ? Uint32Array : max <= Number.MAX_SAFE_INTEGER ? ZeroArray : null;
var ZeroArray = class extends Array {
  constructor(size) {
    super(size);
    this.fill(0);
  }
};
var Stack = class _Stack {
  heap;
  length;
  // private constructor
  static #constructing = false;
  static create(max) {
    const HeapCls = getUintArray(max);
    if (!HeapCls)
      return [];
    _Stack.#constructing = true;
    const s = new _Stack(max, HeapCls);
    _Stack.#constructing = false;
    return s;
  }
  constructor(max, HeapCls) {
    if (!_Stack.#constructing) {
      throw new TypeError("instantiate Stack using Stack.create(n)");
    }
    this.heap = new HeapCls(max);
    this.length = 0;
  }
  push(n) {
    this.heap[this.length++] = n;
  }
  pop() {
    return this.heap[--this.length];
  }
};
var LRUCache = class _LRUCache {
  // options that cannot be changed without disaster
  #max;
  #maxSize;
  #dispose;
  #disposeAfter;
  #fetchMethod;
  #memoMethod;
  /**
   * {@link LRUCache.OptionsBase.ttl}
   */
  ttl;
  /**
   * {@link LRUCache.OptionsBase.ttlResolution}
   */
  ttlResolution;
  /**
   * {@link LRUCache.OptionsBase.ttlAutopurge}
   */
  ttlAutopurge;
  /**
   * {@link LRUCache.OptionsBase.updateAgeOnGet}
   */
  updateAgeOnGet;
  /**
   * {@link LRUCache.OptionsBase.updateAgeOnHas}
   */
  updateAgeOnHas;
  /**
   * {@link LRUCache.OptionsBase.allowStale}
   */
  allowStale;
  /**
   * {@link LRUCache.OptionsBase.noDisposeOnSet}
   */
  noDisposeOnSet;
  /**
   * {@link LRUCache.OptionsBase.noUpdateTTL}
   */
  noUpdateTTL;
  /**
   * {@link LRUCache.OptionsBase.maxEntrySize}
   */
  maxEntrySize;
  /**
   * {@link LRUCache.OptionsBase.sizeCalculation}
   */
  sizeCalculation;
  /**
   * {@link LRUCache.OptionsBase.noDeleteOnFetchRejection}
   */
  noDeleteOnFetchRejection;
  /**
   * {@link LRUCache.OptionsBase.noDeleteOnStaleGet}
   */
  noDeleteOnStaleGet;
  /**
   * {@link LRUCache.OptionsBase.allowStaleOnFetchAbort}
   */
  allowStaleOnFetchAbort;
  /**
   * {@link LRUCache.OptionsBase.allowStaleOnFetchRejection}
   */
  allowStaleOnFetchRejection;
  /**
   * {@link LRUCache.OptionsBase.ignoreFetchAbort}
   */
  ignoreFetchAbort;
  // computed properties
  #size;
  #calculatedSize;
  #keyMap;
  #keyList;
  #valList;
  #next;
  #prev;
  #head;
  #tail;
  #free;
  #disposed;
  #sizes;
  #starts;
  #ttls;
  #hasDispose;
  #hasFetchMethod;
  #hasDisposeAfter;
  /**
   * Do not call this method unless you need to inspect the
   * inner workings of the cache.  If anything returned by this
   * object is modified in any way, strange breakage may occur.
   *
   * These fields are private for a reason!
   *
   * @internal
   */
  static unsafeExposeInternals(c) {
    return {
      // properties
      starts: c.#starts,
      ttls: c.#ttls,
      sizes: c.#sizes,
      keyMap: c.#keyMap,
      keyList: c.#keyList,
      valList: c.#valList,
      next: c.#next,
      prev: c.#prev,
      get head() {
        return c.#head;
      },
      get tail() {
        return c.#tail;
      },
      free: c.#free,
      // methods
      isBackgroundFetch: (p) => c.#isBackgroundFetch(p),
      backgroundFetch: (k, index, options, context) => c.#backgroundFetch(k, index, options, context),
      moveToTail: (index) => c.#moveToTail(index),
      indexes: (options) => c.#indexes(options),
      rindexes: (options) => c.#rindexes(options),
      isStale: (index) => c.#isStale(index)
    };
  }
  // Protected read-only members
  /**
   * {@link LRUCache.OptionsBase.max} (read-only)
   */
  get max() {
    return this.#max;
  }
  /**
   * {@link LRUCache.OptionsBase.maxSize} (read-only)
   */
  get maxSize() {
    return this.#maxSize;
  }
  /**
   * The total computed size of items in the cache (read-only)
   */
  get calculatedSize() {
    return this.#calculatedSize;
  }
  /**
   * The number of items stored in the cache (read-only)
   */
  get size() {
    return this.#size;
  }
  /**
   * {@link LRUCache.OptionsBase.fetchMethod} (read-only)
   */
  get fetchMethod() {
    return this.#fetchMethod;
  }
  get memoMethod() {
    return this.#memoMethod;
  }
  /**
   * {@link LRUCache.OptionsBase.dispose} (read-only)
   */
  get dispose() {
    return this.#dispose;
  }
  /**
   * {@link LRUCache.OptionsBase.disposeAfter} (read-only)
   */
  get disposeAfter() {
    return this.#disposeAfter;
  }
  constructor(options) {
    const { max = 0, ttl, ttlResolution = 1, ttlAutopurge, updateAgeOnGet, updateAgeOnHas, allowStale, dispose, disposeAfter, noDisposeOnSet, noUpdateTTL, maxSize = 0, maxEntrySize = 0, sizeCalculation, fetchMethod, memoMethod, noDeleteOnFetchRejection, noDeleteOnStaleGet, allowStaleOnFetchRejection, allowStaleOnFetchAbort, ignoreFetchAbort } = options;
    if (max !== 0 && !isPosInt(max)) {
      throw new TypeError("max option must be a nonnegative integer");
    }
    const UintArray = max ? getUintArray(max) : Array;
    if (!UintArray) {
      throw new Error("invalid max value: " + max);
    }
    this.#max = max;
    this.#maxSize = maxSize;
    this.maxEntrySize = maxEntrySize || this.#maxSize;
    this.sizeCalculation = sizeCalculation;
    if (this.sizeCalculation) {
      if (!this.#maxSize && !this.maxEntrySize) {
        throw new TypeError("cannot set sizeCalculation without setting maxSize or maxEntrySize");
      }
      if (typeof this.sizeCalculation !== "function") {
        throw new TypeError("sizeCalculation set to non-function");
      }
    }
    if (memoMethod !== void 0 && typeof memoMethod !== "function") {
      throw new TypeError("memoMethod must be a function if defined");
    }
    this.#memoMethod = memoMethod;
    if (fetchMethod !== void 0 && typeof fetchMethod !== "function") {
      throw new TypeError("fetchMethod must be a function if specified");
    }
    this.#fetchMethod = fetchMethod;
    this.#hasFetchMethod = !!fetchMethod;
    this.#keyMap = /* @__PURE__ */ new Map();
    this.#keyList = new Array(max).fill(void 0);
    this.#valList = new Array(max).fill(void 0);
    this.#next = new UintArray(max);
    this.#prev = new UintArray(max);
    this.#head = 0;
    this.#tail = 0;
    this.#free = Stack.create(max);
    this.#size = 0;
    this.#calculatedSize = 0;
    if (typeof dispose === "function") {
      this.#dispose = dispose;
    }
    if (typeof disposeAfter === "function") {
      this.#disposeAfter = disposeAfter;
      this.#disposed = [];
    } else {
      this.#disposeAfter = void 0;
      this.#disposed = void 0;
    }
    this.#hasDispose = !!this.#dispose;
    this.#hasDisposeAfter = !!this.#disposeAfter;
    this.noDisposeOnSet = !!noDisposeOnSet;
    this.noUpdateTTL = !!noUpdateTTL;
    this.noDeleteOnFetchRejection = !!noDeleteOnFetchRejection;
    this.allowStaleOnFetchRejection = !!allowStaleOnFetchRejection;
    this.allowStaleOnFetchAbort = !!allowStaleOnFetchAbort;
    this.ignoreFetchAbort = !!ignoreFetchAbort;
    if (this.maxEntrySize !== 0) {
      if (this.#maxSize !== 0) {
        if (!isPosInt(this.#maxSize)) {
          throw new TypeError("maxSize must be a positive integer if specified");
        }
      }
      if (!isPosInt(this.maxEntrySize)) {
        throw new TypeError("maxEntrySize must be a positive integer if specified");
      }
      this.#initializeSizeTracking();
    }
    this.allowStale = !!allowStale;
    this.noDeleteOnStaleGet = !!noDeleteOnStaleGet;
    this.updateAgeOnGet = !!updateAgeOnGet;
    this.updateAgeOnHas = !!updateAgeOnHas;
    this.ttlResolution = isPosInt(ttlResolution) || ttlResolution === 0 ? ttlResolution : 1;
    this.ttlAutopurge = !!ttlAutopurge;
    this.ttl = ttl || 0;
    if (this.ttl) {
      if (!isPosInt(this.ttl)) {
        throw new TypeError("ttl must be a positive integer if specified");
      }
      this.#initializeTTLTracking();
    }
    if (this.#max === 0 && this.ttl === 0 && this.#maxSize === 0) {
      throw new TypeError("At least one of max, maxSize, or ttl is required");
    }
    if (!this.ttlAutopurge && !this.#max && !this.#maxSize) {
      const code = "LRU_CACHE_UNBOUNDED";
      if (shouldWarn(code)) {
        warned.add(code);
        const msg = "TTL caching without ttlAutopurge, max, or maxSize can result in unbounded memory consumption.";
        emitWarning(msg, "UnboundedCacheWarning", code, _LRUCache);
      }
    }
  }
  /**
   * Return the number of ms left in the item's TTL. If item is not in cache,
   * returns `0`. Returns `Infinity` if item is in cache without a defined TTL.
   */
  getRemainingTTL(key) {
    return this.#keyMap.has(key) ? Infinity : 0;
  }
  #initializeTTLTracking() {
    const ttls = new ZeroArray(this.#max);
    const starts = new ZeroArray(this.#max);
    this.#ttls = ttls;
    this.#starts = starts;
    this.#setItemTTL = (index, ttl, start = perf.now()) => {
      starts[index] = ttl !== 0 ? start : 0;
      ttls[index] = ttl;
      if (ttl !== 0 && this.ttlAutopurge) {
        const t = setTimeout(() => {
          if (this.#isStale(index)) {
            this.#delete(this.#keyList[index], "expire");
          }
        }, ttl + 1);
        if (t.unref) {
          t.unref();
        }
      }
    };
    this.#updateItemAge = (index) => {
      starts[index] = ttls[index] !== 0 ? perf.now() : 0;
    };
    this.#statusTTL = (status, index) => {
      if (ttls[index]) {
        const ttl = ttls[index];
        const start = starts[index];
        if (!ttl || !start)
          return;
        status.ttl = ttl;
        status.start = start;
        status.now = cachedNow || getNow();
        const age = status.now - start;
        status.remainingTTL = ttl - age;
      }
    };
    let cachedNow = 0;
    const getNow = () => {
      const n = perf.now();
      if (this.ttlResolution > 0) {
        cachedNow = n;
        const t = setTimeout(() => cachedNow = 0, this.ttlResolution);
        if (t.unref) {
          t.unref();
        }
      }
      return n;
    };
    this.getRemainingTTL = (key) => {
      const index = this.#keyMap.get(key);
      if (index === void 0) {
        return 0;
      }
      const ttl = ttls[index];
      const start = starts[index];
      if (!ttl || !start) {
        return Infinity;
      }
      const age = (cachedNow || getNow()) - start;
      return ttl - age;
    };
    this.#isStale = (index) => {
      const s = starts[index];
      const t = ttls[index];
      return !!t && !!s && (cachedNow || getNow()) - s > t;
    };
  }
  // conditionally set private methods related to TTL
  #updateItemAge = () => {
  };
  #statusTTL = () => {
  };
  #setItemTTL = () => {
  };
  /* c8 ignore stop */
  #isStale = () => false;
  #initializeSizeTracking() {
    const sizes = new ZeroArray(this.#max);
    this.#calculatedSize = 0;
    this.#sizes = sizes;
    this.#removeItemSize = (index) => {
      this.#calculatedSize -= sizes[index];
      sizes[index] = 0;
    };
    this.#requireSize = (k, v, size, sizeCalculation) => {
      if (this.#isBackgroundFetch(v)) {
        return 0;
      }
      if (!isPosInt(size)) {
        if (sizeCalculation) {
          if (typeof sizeCalculation !== "function") {
            throw new TypeError("sizeCalculation must be a function");
          }
          size = sizeCalculation(v, k);
          if (!isPosInt(size)) {
            throw new TypeError("sizeCalculation return invalid (expect positive integer)");
          }
        } else {
          throw new TypeError("invalid size value (must be positive integer). When maxSize or maxEntrySize is used, sizeCalculation or size must be set.");
        }
      }
      return size;
    };
    this.#addItemSize = (index, size, status) => {
      sizes[index] = size;
      if (this.#maxSize) {
        const maxSize = this.#maxSize - sizes[index];
        while (this.#calculatedSize > maxSize) {
          this.#evict(true);
        }
      }
      this.#calculatedSize += sizes[index];
      if (status) {
        status.entrySize = size;
        status.totalCalculatedSize = this.#calculatedSize;
      }
    };
  }
  #removeItemSize = (_i) => {
  };
  #addItemSize = (_i, _s, _st) => {
  };
  #requireSize = (_k, _v, size, sizeCalculation) => {
    if (size || sizeCalculation) {
      throw new TypeError("cannot set size without setting maxSize or maxEntrySize on cache");
    }
    return 0;
  };
  *#indexes({ allowStale = this.allowStale } = {}) {
    if (this.#size) {
      for (let i = this.#tail; true; ) {
        if (!this.#isValidIndex(i)) {
          break;
        }
        if (allowStale || !this.#isStale(i)) {
          yield i;
        }
        if (i === this.#head) {
          break;
        } else {
          i = this.#prev[i];
        }
      }
    }
  }
  *#rindexes({ allowStale = this.allowStale } = {}) {
    if (this.#size) {
      for (let i = this.#head; true; ) {
        if (!this.#isValidIndex(i)) {
          break;
        }
        if (allowStale || !this.#isStale(i)) {
          yield i;
        }
        if (i === this.#tail) {
          break;
        } else {
          i = this.#next[i];
        }
      }
    }
  }
  #isValidIndex(index) {
    return index !== void 0 && this.#keyMap.get(this.#keyList[index]) === index;
  }
  /**
   * Return a generator yielding `[key, value]` pairs,
   * in order from most recently used to least recently used.
   */
  *entries() {
    for (const i of this.#indexes()) {
      if (this.#valList[i] !== void 0 && this.#keyList[i] !== void 0 && !this.#isBackgroundFetch(this.#valList[i])) {
        yield [this.#keyList[i], this.#valList[i]];
      }
    }
  }
  /**
   * Inverse order version of {@link LRUCache.entries}
   *
   * Return a generator yielding `[key, value]` pairs,
   * in order from least recently used to most recently used.
   */
  *rentries() {
    for (const i of this.#rindexes()) {
      if (this.#valList[i] !== void 0 && this.#keyList[i] !== void 0 && !this.#isBackgroundFetch(this.#valList[i])) {
        yield [this.#keyList[i], this.#valList[i]];
      }
    }
  }
  /**
   * Return a generator yielding the keys in the cache,
   * in order from most recently used to least recently used.
   */
  *keys() {
    for (const i of this.#indexes()) {
      const k = this.#keyList[i];
      if (k !== void 0 && !this.#isBackgroundFetch(this.#valList[i])) {
        yield k;
      }
    }
  }
  /**
   * Inverse order version of {@link LRUCache.keys}
   *
   * Return a generator yielding the keys in the cache,
   * in order from least recently used to most recently used.
   */
  *rkeys() {
    for (const i of this.#rindexes()) {
      const k = this.#keyList[i];
      if (k !== void 0 && !this.#isBackgroundFetch(this.#valList[i])) {
        yield k;
      }
    }
  }
  /**
   * Return a generator yielding the values in the cache,
   * in order from most recently used to least recently used.
   */
  *values() {
    for (const i of this.#indexes()) {
      const v = this.#valList[i];
      if (v !== void 0 && !this.#isBackgroundFetch(this.#valList[i])) {
        yield this.#valList[i];
      }
    }
  }
  /**
   * Inverse order version of {@link LRUCache.values}
   *
   * Return a generator yielding the values in the cache,
   * in order from least recently used to most recently used.
   */
  *rvalues() {
    for (const i of this.#rindexes()) {
      const v = this.#valList[i];
      if (v !== void 0 && !this.#isBackgroundFetch(this.#valList[i])) {
        yield this.#valList[i];
      }
    }
  }
  /**
   * Iterating over the cache itself yields the same results as
   * {@link LRUCache.entries}
   */
  [Symbol.iterator]() {
    return this.entries();
  }
  /**
   * A String value that is used in the creation of the default string
   * description of an object. Called by the built-in method
   * `Object.prototype.toString`.
   */
  [Symbol.toStringTag] = "LRUCache";
  /**
   * Find a value for which the supplied fn method returns a truthy value,
   * similar to `Array.find()`. fn is called as `fn(value, key, cache)`.
   */
  find(fn, getOptions = {}) {
    for (const i of this.#indexes()) {
      const v = this.#valList[i];
      const value = this.#isBackgroundFetch(v) ? v.__staleWhileFetching : v;
      if (value === void 0)
        continue;
      if (fn(value, this.#keyList[i], this)) {
        return this.get(this.#keyList[i], getOptions);
      }
    }
  }
  /**
   * Call the supplied function on each item in the cache, in order from most
   * recently used to least recently used.
   *
   * `fn` is called as `fn(value, key, cache)`.
   *
   * If `thisp` is provided, function will be called in the `this`-context of
   * the provided object, or the cache if no `thisp` object is provided.
   *
   * Does not update age or recenty of use, or iterate over stale values.
   */
  forEach(fn, thisp = this) {
    for (const i of this.#indexes()) {
      const v = this.#valList[i];
      const value = this.#isBackgroundFetch(v) ? v.__staleWhileFetching : v;
      if (value === void 0)
        continue;
      fn.call(thisp, value, this.#keyList[i], this);
    }
  }
  /**
   * The same as {@link LRUCache.forEach} but items are iterated over in
   * reverse order.  (ie, less recently used items are iterated over first.)
   */
  rforEach(fn, thisp = this) {
    for (const i of this.#rindexes()) {
      const v = this.#valList[i];
      const value = this.#isBackgroundFetch(v) ? v.__staleWhileFetching : v;
      if (value === void 0)
        continue;
      fn.call(thisp, value, this.#keyList[i], this);
    }
  }
  /**
   * Delete any stale entries. Returns true if anything was removed,
   * false otherwise.
   */
  purgeStale() {
    let deleted = false;
    for (const i of this.#rindexes({ allowStale: true })) {
      if (this.#isStale(i)) {
        this.#delete(this.#keyList[i], "expire");
        deleted = true;
      }
    }
    return deleted;
  }
  /**
   * Get the extended info about a given entry, to get its value, size, and
   * TTL info simultaneously. Returns `undefined` if the key is not present.
   *
   * Unlike {@link LRUCache#dump}, which is designed to be portable and survive
   * serialization, the `start` value is always the current timestamp, and the
   * `ttl` is a calculated remaining time to live (negative if expired).
   *
   * Always returns stale values, if their info is found in the cache, so be
   * sure to check for expirations (ie, a negative {@link LRUCache.Entry#ttl})
   * if relevant.
   */
  info(key) {
    const i = this.#keyMap.get(key);
    if (i === void 0)
      return void 0;
    const v = this.#valList[i];
    const value = this.#isBackgroundFetch(v) ? v.__staleWhileFetching : v;
    if (value === void 0)
      return void 0;
    const entry = { value };
    if (this.#ttls && this.#starts) {
      const ttl = this.#ttls[i];
      const start = this.#starts[i];
      if (ttl && start) {
        const remain = ttl - (perf.now() - start);
        entry.ttl = remain;
        entry.start = Date.now();
      }
    }
    if (this.#sizes) {
      entry.size = this.#sizes[i];
    }
    return entry;
  }
  /**
   * Return an array of [key, {@link LRUCache.Entry}] tuples which can be
   * passed to {@link LRLUCache#load}.
   *
   * The `start` fields are calculated relative to a portable `Date.now()`
   * timestamp, even if `performance.now()` is available.
   *
   * Stale entries are always included in the `dump`, even if
   * {@link LRUCache.OptionsBase.allowStale} is false.
   *
   * Note: this returns an actual array, not a generator, so it can be more
   * easily passed around.
   */
  dump() {
    const arr = [];
    for (const i of this.#indexes({ allowStale: true })) {
      const key = this.#keyList[i];
      const v = this.#valList[i];
      const value = this.#isBackgroundFetch(v) ? v.__staleWhileFetching : v;
      if (value === void 0 || key === void 0)
        continue;
      const entry = { value };
      if (this.#ttls && this.#starts) {
        entry.ttl = this.#ttls[i];
        const age = perf.now() - this.#starts[i];
        entry.start = Math.floor(Date.now() - age);
      }
      if (this.#sizes) {
        entry.size = this.#sizes[i];
      }
      arr.unshift([key, entry]);
    }
    return arr;
  }
  /**
   * Reset the cache and load in the items in entries in the order listed.
   *
   * The shape of the resulting cache may be different if the same options are
   * not used in both caches.
   *
   * The `start` fields are assumed to be calculated relative to a portable
   * `Date.now()` timestamp, even if `performance.now()` is available.
   */
  load(arr) {
    this.clear();
    for (const [key, entry] of arr) {
      if (entry.start) {
        const age = Date.now() - entry.start;
        entry.start = perf.now() - age;
      }
      this.set(key, entry.value, entry);
    }
  }
  /**
   * Add a value to the cache.
   *
   * Note: if `undefined` is specified as a value, this is an alias for
   * {@link LRUCache#delete}
   *
   * Fields on the {@link LRUCache.SetOptions} options param will override
   * their corresponding values in the constructor options for the scope
   * of this single `set()` operation.
   *
   * If `start` is provided, then that will set the effective start
   * time for the TTL calculation. Note that this must be a previous
   * value of `performance.now()` if supported, or a previous value of
   * `Date.now()` if not.
   *
   * Options object may also include `size`, which will prevent
   * calling the `sizeCalculation` function and just use the specified
   * number if it is a positive integer, and `noDisposeOnSet` which
   * will prevent calling a `dispose` function in the case of
   * overwrites.
   *
   * If the `size` (or return value of `sizeCalculation`) for a given
   * entry is greater than `maxEntrySize`, then the item will not be
   * added to the cache.
   *
   * Will update the recency of the entry.
   *
   * If the value is `undefined`, then this is an alias for
   * `cache.delete(key)`. `undefined` is never stored in the cache.
   */
  set(k, v, setOptions = {}) {
    if (v === void 0) {
      this.delete(k);
      return this;
    }
    const { ttl = this.ttl, start, noDisposeOnSet = this.noDisposeOnSet, sizeCalculation = this.sizeCalculation, status } = setOptions;
    let { noUpdateTTL = this.noUpdateTTL } = setOptions;
    const size = this.#requireSize(k, v, setOptions.size || 0, sizeCalculation);
    if (this.maxEntrySize && size > this.maxEntrySize) {
      if (status) {
        status.set = "miss";
        status.maxEntrySizeExceeded = true;
      }
      this.#delete(k, "set");
      return this;
    }
    let index = this.#size === 0 ? void 0 : this.#keyMap.get(k);
    if (index === void 0) {
      index = this.#size === 0 ? this.#tail : this.#free.length !== 0 ? this.#free.pop() : this.#size === this.#max ? this.#evict(false) : this.#size;
      this.#keyList[index] = k;
      this.#valList[index] = v;
      this.#keyMap.set(k, index);
      this.#next[this.#tail] = index;
      this.#prev[index] = this.#tail;
      this.#tail = index;
      this.#size++;
      this.#addItemSize(index, size, status);
      if (status)
        status.set = "add";
      noUpdateTTL = false;
    } else {
      this.#moveToTail(index);
      const oldVal = this.#valList[index];
      if (v !== oldVal) {
        if (this.#hasFetchMethod && this.#isBackgroundFetch(oldVal)) {
          oldVal.__abortController.abort(new Error("replaced"));
          const { __staleWhileFetching: s } = oldVal;
          if (s !== void 0 && !noDisposeOnSet) {
            if (this.#hasDispose) {
              this.#dispose?.(s, k, "set");
            }
            if (this.#hasDisposeAfter) {
              this.#disposed?.push([s, k, "set"]);
            }
          }
        } else if (!noDisposeOnSet) {
          if (this.#hasDispose) {
            this.#dispose?.(oldVal, k, "set");
          }
          if (this.#hasDisposeAfter) {
            this.#disposed?.push([oldVal, k, "set"]);
          }
        }
        this.#removeItemSize(index);
        this.#addItemSize(index, size, status);
        this.#valList[index] = v;
        if (status) {
          status.set = "replace";
          const oldValue = oldVal && this.#isBackgroundFetch(oldVal) ? oldVal.__staleWhileFetching : oldVal;
          if (oldValue !== void 0)
            status.oldValue = oldValue;
        }
      } else if (status) {
        status.set = "update";
      }
    }
    if (ttl !== 0 && !this.#ttls) {
      this.#initializeTTLTracking();
    }
    if (this.#ttls) {
      if (!noUpdateTTL) {
        this.#setItemTTL(index, ttl, start);
      }
      if (status)
        this.#statusTTL(status, index);
    }
    if (!noDisposeOnSet && this.#hasDisposeAfter && this.#disposed) {
      const dt = this.#disposed;
      let task;
      while (task = dt?.shift()) {
        this.#disposeAfter?.(...task);
      }
    }
    return this;
  }
  /**
   * Evict the least recently used item, returning its value or
   * `undefined` if cache is empty.
   */
  pop() {
    try {
      while (this.#size) {
        const val = this.#valList[this.#head];
        this.#evict(true);
        if (this.#isBackgroundFetch(val)) {
          if (val.__staleWhileFetching) {
            return val.__staleWhileFetching;
          }
        } else if (val !== void 0) {
          return val;
        }
      }
    } finally {
      if (this.#hasDisposeAfter && this.#disposed) {
        const dt = this.#disposed;
        let task;
        while (task = dt?.shift()) {
          this.#disposeAfter?.(...task);
        }
      }
    }
  }
  #evict(free) {
    const head = this.#head;
    const k = this.#keyList[head];
    const v = this.#valList[head];
    if (this.#hasFetchMethod && this.#isBackgroundFetch(v)) {
      v.__abortController.abort(new Error("evicted"));
    } else if (this.#hasDispose || this.#hasDisposeAfter) {
      if (this.#hasDispose) {
        this.#dispose?.(v, k, "evict");
      }
      if (this.#hasDisposeAfter) {
        this.#disposed?.push([v, k, "evict"]);
      }
    }
    this.#removeItemSize(head);
    if (free) {
      this.#keyList[head] = void 0;
      this.#valList[head] = void 0;
      this.#free.push(head);
    }
    if (this.#size === 1) {
      this.#head = this.#tail = 0;
      this.#free.length = 0;
    } else {
      this.#head = this.#next[head];
    }
    this.#keyMap.delete(k);
    this.#size--;
    return head;
  }
  /**
   * Check if a key is in the cache, without updating the recency of use.
   * Will return false if the item is stale, even though it is technically
   * in the cache.
   *
   * Check if a key is in the cache, without updating the recency of
   * use. Age is updated if {@link LRUCache.OptionsBase.updateAgeOnHas} is set
   * to `true` in either the options or the constructor.
   *
   * Will return `false` if the item is stale, even though it is technically in
   * the cache. The difference can be determined (if it matters) by using a
   * `status` argument, and inspecting the `has` field.
   *
   * Will not update item age unless
   * {@link LRUCache.OptionsBase.updateAgeOnHas} is set.
   */
  has(k, hasOptions = {}) {
    const { updateAgeOnHas = this.updateAgeOnHas, status } = hasOptions;
    const index = this.#keyMap.get(k);
    if (index !== void 0) {
      const v = this.#valList[index];
      if (this.#isBackgroundFetch(v) && v.__staleWhileFetching === void 0) {
        return false;
      }
      if (!this.#isStale(index)) {
        if (updateAgeOnHas) {
          this.#updateItemAge(index);
        }
        if (status) {
          status.has = "hit";
          this.#statusTTL(status, index);
        }
        return true;
      } else if (status) {
        status.has = "stale";
        this.#statusTTL(status, index);
      }
    } else if (status) {
      status.has = "miss";
    }
    return false;
  }
  /**
   * Like {@link LRUCache#get} but doesn't update recency or delete stale
   * items.
   *
   * Returns `undefined` if the item is stale, unless
   * {@link LRUCache.OptionsBase.allowStale} is set.
   */
  peek(k, peekOptions = {}) {
    const { allowStale = this.allowStale } = peekOptions;
    const index = this.#keyMap.get(k);
    if (index === void 0 || !allowStale && this.#isStale(index)) {
      return;
    }
    const v = this.#valList[index];
    return this.#isBackgroundFetch(v) ? v.__staleWhileFetching : v;
  }
  #backgroundFetch(k, index, options, context) {
    const v = index === void 0 ? void 0 : this.#valList[index];
    if (this.#isBackgroundFetch(v)) {
      return v;
    }
    const ac = new AC();
    const { signal } = options;
    signal?.addEventListener("abort", () => ac.abort(signal.reason), {
      signal: ac.signal
    });
    const fetchOpts = {
      signal: ac.signal,
      options,
      context
    };
    const cb = (v2, updateCache = false) => {
      const { aborted } = ac.signal;
      const ignoreAbort = options.ignoreFetchAbort && v2 !== void 0;
      if (options.status) {
        if (aborted && !updateCache) {
          options.status.fetchAborted = true;
          options.status.fetchError = ac.signal.reason;
          if (ignoreAbort)
            options.status.fetchAbortIgnored = true;
        } else {
          options.status.fetchResolved = true;
        }
      }
      if (aborted && !ignoreAbort && !updateCache) {
        return fetchFail(ac.signal.reason);
      }
      const bf2 = p;
      if (this.#valList[index] === p) {
        if (v2 === void 0) {
          if (bf2.__staleWhileFetching) {
            this.#valList[index] = bf2.__staleWhileFetching;
          } else {
            this.#delete(k, "fetch");
          }
        } else {
          if (options.status)
            options.status.fetchUpdated = true;
          this.set(k, v2, fetchOpts.options);
        }
      }
      return v2;
    };
    const eb = (er) => {
      if (options.status) {
        options.status.fetchRejected = true;
        options.status.fetchError = er;
      }
      return fetchFail(er);
    };
    const fetchFail = (er) => {
      const { aborted } = ac.signal;
      const allowStaleAborted = aborted && options.allowStaleOnFetchAbort;
      const allowStale = allowStaleAborted || options.allowStaleOnFetchRejection;
      const noDelete = allowStale || options.noDeleteOnFetchRejection;
      const bf2 = p;
      if (this.#valList[index] === p) {
        const del = !noDelete || bf2.__staleWhileFetching === void 0;
        if (del) {
          this.#delete(k, "fetch");
        } else if (!allowStaleAborted) {
          this.#valList[index] = bf2.__staleWhileFetching;
        }
      }
      if (allowStale) {
        if (options.status && bf2.__staleWhileFetching !== void 0) {
          options.status.returnedStale = true;
        }
        return bf2.__staleWhileFetching;
      } else if (bf2.__returned === bf2) {
        throw er;
      }
    };
    const pcall = (res, rej) => {
      const fmp = this.#fetchMethod?.(k, v, fetchOpts);
      if (fmp && fmp instanceof Promise) {
        fmp.then((v2) => res(v2 === void 0 ? void 0 : v2), rej);
      }
      ac.signal.addEventListener("abort", () => {
        if (!options.ignoreFetchAbort || options.allowStaleOnFetchAbort) {
          res(void 0);
          if (options.allowStaleOnFetchAbort) {
            res = (v2) => cb(v2, true);
          }
        }
      });
    };
    if (options.status)
      options.status.fetchDispatched = true;
    const p = new Promise(pcall).then(cb, eb);
    const bf = Object.assign(p, {
      __abortController: ac,
      __staleWhileFetching: v,
      __returned: void 0
    });
    if (index === void 0) {
      this.set(k, bf, { ...fetchOpts.options, status: void 0 });
      index = this.#keyMap.get(k);
    } else {
      this.#valList[index] = bf;
    }
    return bf;
  }
  #isBackgroundFetch(p) {
    if (!this.#hasFetchMethod)
      return false;
    const b = p;
    return !!b && b instanceof Promise && b.hasOwnProperty("__staleWhileFetching") && b.__abortController instanceof AC;
  }
  async fetch(k, fetchOptions = {}) {
    const {
      // get options
      allowStale = this.allowStale,
      updateAgeOnGet = this.updateAgeOnGet,
      noDeleteOnStaleGet = this.noDeleteOnStaleGet,
      // set options
      ttl = this.ttl,
      noDisposeOnSet = this.noDisposeOnSet,
      size = 0,
      sizeCalculation = this.sizeCalculation,
      noUpdateTTL = this.noUpdateTTL,
      // fetch exclusive options
      noDeleteOnFetchRejection = this.noDeleteOnFetchRejection,
      allowStaleOnFetchRejection = this.allowStaleOnFetchRejection,
      ignoreFetchAbort = this.ignoreFetchAbort,
      allowStaleOnFetchAbort = this.allowStaleOnFetchAbort,
      context,
      forceRefresh = false,
      status,
      signal
    } = fetchOptions;
    if (!this.#hasFetchMethod) {
      if (status)
        status.fetch = "get";
      return this.get(k, {
        allowStale,
        updateAgeOnGet,
        noDeleteOnStaleGet,
        status
      });
    }
    const options = {
      allowStale,
      updateAgeOnGet,
      noDeleteOnStaleGet,
      ttl,
      noDisposeOnSet,
      size,
      sizeCalculation,
      noUpdateTTL,
      noDeleteOnFetchRejection,
      allowStaleOnFetchRejection,
      allowStaleOnFetchAbort,
      ignoreFetchAbort,
      status,
      signal
    };
    let index = this.#keyMap.get(k);
    if (index === void 0) {
      if (status)
        status.fetch = "miss";
      const p = this.#backgroundFetch(k, index, options, context);
      return p.__returned = p;
    } else {
      const v = this.#valList[index];
      if (this.#isBackgroundFetch(v)) {
        const stale = allowStale && v.__staleWhileFetching !== void 0;
        if (status) {
          status.fetch = "inflight";
          if (stale)
            status.returnedStale = true;
        }
        return stale ? v.__staleWhileFetching : v.__returned = v;
      }
      const isStale = this.#isStale(index);
      if (!forceRefresh && !isStale) {
        if (status)
          status.fetch = "hit";
        this.#moveToTail(index);
        if (updateAgeOnGet) {
          this.#updateItemAge(index);
        }
        if (status)
          this.#statusTTL(status, index);
        return v;
      }
      const p = this.#backgroundFetch(k, index, options, context);
      const hasStale = p.__staleWhileFetching !== void 0;
      const staleVal = hasStale && allowStale;
      if (status) {
        status.fetch = isStale ? "stale" : "refresh";
        if (staleVal && isStale)
          status.returnedStale = true;
      }
      return staleVal ? p.__staleWhileFetching : p.__returned = p;
    }
  }
  async forceFetch(k, fetchOptions = {}) {
    const v = await this.fetch(k, fetchOptions);
    if (v === void 0)
      throw new Error("fetch() returned undefined");
    return v;
  }
  memo(k, memoOptions = {}) {
    const memoMethod = this.#memoMethod;
    if (!memoMethod) {
      throw new Error("no memoMethod provided to constructor");
    }
    const { context, forceRefresh, ...options } = memoOptions;
    const v = this.get(k, options);
    if (!forceRefresh && v !== void 0)
      return v;
    const vv = memoMethod(k, v, {
      options,
      context
    });
    this.set(k, vv, options);
    return vv;
  }
  /**
   * Return a value from the cache. Will update the recency of the cache
   * entry found.
   *
   * If the key is not found, get() will return `undefined`.
   */
  get(k, getOptions = {}) {
    const { allowStale = this.allowStale, updateAgeOnGet = this.updateAgeOnGet, noDeleteOnStaleGet = this.noDeleteOnStaleGet, status } = getOptions;
    const index = this.#keyMap.get(k);
    if (index !== void 0) {
      const value = this.#valList[index];
      const fetching = this.#isBackgroundFetch(value);
      if (status)
        this.#statusTTL(status, index);
      if (this.#isStale(index)) {
        if (status)
          status.get = "stale";
        if (!fetching) {
          if (!noDeleteOnStaleGet) {
            this.#delete(k, "expire");
          }
          if (status && allowStale)
            status.returnedStale = true;
          return allowStale ? value : void 0;
        } else {
          if (status && allowStale && value.__staleWhileFetching !== void 0) {
            status.returnedStale = true;
          }
          return allowStale ? value.__staleWhileFetching : void 0;
        }
      } else {
        if (status)
          status.get = "hit";
        if (fetching) {
          return value.__staleWhileFetching;
        }
        this.#moveToTail(index);
        if (updateAgeOnGet) {
          this.#updateItemAge(index);
        }
        return value;
      }
    } else if (status) {
      status.get = "miss";
    }
  }
  #connect(p, n) {
    this.#prev[n] = p;
    this.#next[p] = n;
  }
  #moveToTail(index) {
    if (index !== this.#tail) {
      if (index === this.#head) {
        this.#head = this.#next[index];
      } else {
        this.#connect(this.#prev[index], this.#next[index]);
      }
      this.#connect(this.#tail, index);
      this.#tail = index;
    }
  }
  /**
   * Deletes a key out of the cache.
   *
   * Returns true if the key was deleted, false otherwise.
   */
  delete(k) {
    return this.#delete(k, "delete");
  }
  #delete(k, reason) {
    let deleted = false;
    if (this.#size !== 0) {
      const index = this.#keyMap.get(k);
      if (index !== void 0) {
        deleted = true;
        if (this.#size === 1) {
          this.#clear(reason);
        } else {
          this.#removeItemSize(index);
          const v = this.#valList[index];
          if (this.#isBackgroundFetch(v)) {
            v.__abortController.abort(new Error("deleted"));
          } else if (this.#hasDispose || this.#hasDisposeAfter) {
            if (this.#hasDispose) {
              this.#dispose?.(v, k, reason);
            }
            if (this.#hasDisposeAfter) {
              this.#disposed?.push([v, k, reason]);
            }
          }
          this.#keyMap.delete(k);
          this.#keyList[index] = void 0;
          this.#valList[index] = void 0;
          if (index === this.#tail) {
            this.#tail = this.#prev[index];
          } else if (index === this.#head) {
            this.#head = this.#next[index];
          } else {
            const pi = this.#prev[index];
            this.#next[pi] = this.#next[index];
            const ni = this.#next[index];
            this.#prev[ni] = this.#prev[index];
          }
          this.#size--;
          this.#free.push(index);
        }
      }
    }
    if (this.#hasDisposeAfter && this.#disposed?.length) {
      const dt = this.#disposed;
      let task;
      while (task = dt?.shift()) {
        this.#disposeAfter?.(...task);
      }
    }
    return deleted;
  }
  /**
   * Clear the cache entirely, throwing away all values.
   */
  clear() {
    return this.#clear("delete");
  }
  #clear(reason) {
    for (const index of this.#rindexes({ allowStale: true })) {
      const v = this.#valList[index];
      if (this.#isBackgroundFetch(v)) {
        v.__abortController.abort(new Error("deleted"));
      } else {
        const k = this.#keyList[index];
        if (this.#hasDispose) {
          this.#dispose?.(v, k, reason);
        }
        if (this.#hasDisposeAfter) {
          this.#disposed?.push([v, k, reason]);
        }
      }
    }
    this.#keyMap.clear();
    this.#valList.fill(void 0);
    this.#keyList.fill(void 0);
    if (this.#ttls && this.#starts) {
      this.#ttls.fill(0);
      this.#starts.fill(0);
    }
    if (this.#sizes) {
      this.#sizes.fill(0);
    }
    this.#head = 0;
    this.#tail = 0;
    this.#free.length = 0;
    this.#calculatedSize = 0;
    this.#size = 0;
    if (this.#hasDisposeAfter && this.#disposed) {
      const dt = this.#disposed;
      let task;
      while (task = dt?.shift()) {
        this.#disposeAfter?.(...task);
      }
    }
  }
};

// ../../node_modules/path-scurry/dist/esm/index.js
import { posix, win32 } from "path";
import { fileURLToPath } from "url";
import { lstatSync, readdir as readdirCB, readdirSync, readlinkSync, realpathSync as rps } from "fs";
import * as actualFS from "fs";
import { lstat, readdir, readlink, realpath } from "fs/promises";

// ../../node_modules/minipass/dist/esm/index.js
import { EventEmitter } from "events";
import Stream from "stream";
import { StringDecoder } from "string_decoder";
var proc = typeof process === "object" && process ? process : {
  stdout: null,
  stderr: null
};
var isStream = (s) => !!s && typeof s === "object" && (s instanceof Minipass || s instanceof Stream || isReadable(s) || isWritable(s));
var isReadable = (s) => !!s && typeof s === "object" && s instanceof EventEmitter && typeof s.pipe === "function" && // node core Writable streams have a pipe() method, but it throws
s.pipe !== Stream.Writable.prototype.pipe;
var isWritable = (s) => !!s && typeof s === "object" && s instanceof EventEmitter && typeof s.write === "function" && typeof s.end === "function";
var EOF = Symbol("EOF");
var MAYBE_EMIT_END = Symbol("maybeEmitEnd");
var EMITTED_END = Symbol("emittedEnd");
var EMITTING_END = Symbol("emittingEnd");
var EMITTED_ERROR = Symbol("emittedError");
var CLOSED = Symbol("closed");
var READ = Symbol("read");
var FLUSH = Symbol("flush");
var FLUSHCHUNK = Symbol("flushChunk");
var ENCODING = Symbol("encoding");
var DECODER = Symbol("decoder");
var FLOWING = Symbol("flowing");
var PAUSED = Symbol("paused");
var RESUME = Symbol("resume");
var BUFFER = Symbol("buffer");
var PIPES = Symbol("pipes");
var BUFFERLENGTH = Symbol("bufferLength");
var BUFFERPUSH = Symbol("bufferPush");
var BUFFERSHIFT = Symbol("bufferShift");
var OBJECTMODE = Symbol("objectMode");
var DESTROYED = Symbol("destroyed");
var ERROR = Symbol("error");
var EMITDATA = Symbol("emitData");
var EMITEND = Symbol("emitEnd");
var EMITEND2 = Symbol("emitEnd2");
var ASYNC = Symbol("async");
var ABORT = Symbol("abort");
var ABORTED = Symbol("aborted");
var SIGNAL = Symbol("signal");
var DATALISTENERS = Symbol("dataListeners");
var DISCARDED = Symbol("discarded");
var defer = (fn) => Promise.resolve().then(fn);
var nodefer = (fn) => fn();
var isEndish = (ev) => ev === "end" || ev === "finish" || ev === "prefinish";
var isArrayBufferLike = (b) => b instanceof ArrayBuffer || !!b && typeof b === "object" && b.constructor && b.constructor.name === "ArrayBuffer" && b.byteLength >= 0;
var isArrayBufferView = (b) => !Buffer.isBuffer(b) && ArrayBuffer.isView(b);
var Pipe = class {
  src;
  dest;
  opts;
  ondrain;
  constructor(src, dest, opts) {
    this.src = src;
    this.dest = dest;
    this.opts = opts;
    this.ondrain = () => src[RESUME]();
    this.dest.on("drain", this.ondrain);
  }
  unpipe() {
    this.dest.removeListener("drain", this.ondrain);
  }
  // only here for the prototype
  /* c8 ignore start */
  proxyErrors(_er) {
  }
  /* c8 ignore stop */
  end() {
    this.unpipe();
    if (this.opts.end)
      this.dest.end();
  }
};
var PipeProxyErrors = class extends Pipe {
  unpipe() {
    this.src.removeListener("error", this.proxyErrors);
    super.unpipe();
  }
  constructor(src, dest, opts) {
    super(src, dest, opts);
    this.proxyErrors = (er) => dest.emit("error", er);
    src.on("error", this.proxyErrors);
  }
};
var isObjectModeOptions = (o) => !!o.objectMode;
var isEncodingOptions = (o) => !o.objectMode && !!o.encoding && o.encoding !== "buffer";
var Minipass = class extends EventEmitter {
  [FLOWING] = false;
  [PAUSED] = false;
  [PIPES] = [];
  [BUFFER] = [];
  [OBJECTMODE];
  [ENCODING];
  [ASYNC];
  [DECODER];
  [EOF] = false;
  [EMITTED_END] = false;
  [EMITTING_END] = false;
  [CLOSED] = false;
  [EMITTED_ERROR] = null;
  [BUFFERLENGTH] = 0;
  [DESTROYED] = false;
  [SIGNAL];
  [ABORTED] = false;
  [DATALISTENERS] = 0;
  [DISCARDED] = false;
  /**
   * true if the stream can be written
   */
  writable = true;
  /**
   * true if the stream can be read
   */
  readable = true;
  /**
   * If `RType` is Buffer, then options do not need to be provided.
   * Otherwise, an options object must be provided to specify either
   * {@link Minipass.SharedOptions.objectMode} or
   * {@link Minipass.SharedOptions.encoding}, as appropriate.
   */
  constructor(...args) {
    const options = args[0] || {};
    super();
    if (options.objectMode && typeof options.encoding === "string") {
      throw new TypeError("Encoding and objectMode may not be used together");
    }
    if (isObjectModeOptions(options)) {
      this[OBJECTMODE] = true;
      this[ENCODING] = null;
    } else if (isEncodingOptions(options)) {
      this[ENCODING] = options.encoding;
      this[OBJECTMODE] = false;
    } else {
      this[OBJECTMODE] = false;
      this[ENCODING] = null;
    }
    this[ASYNC] = !!options.async;
    this[DECODER] = this[ENCODING] ? new StringDecoder(this[ENCODING]) : null;
    if (options && options.debugExposeBuffer === true) {
      Object.defineProperty(this, "buffer", { get: () => this[BUFFER] });
    }
    if (options && options.debugExposePipes === true) {
      Object.defineProperty(this, "pipes", { get: () => this[PIPES] });
    }
    const { signal } = options;
    if (signal) {
      this[SIGNAL] = signal;
      if (signal.aborted) {
        this[ABORT]();
      } else {
        signal.addEventListener("abort", () => this[ABORT]());
      }
    }
  }
  /**
   * The amount of data stored in the buffer waiting to be read.
   *
   * For Buffer strings, this will be the total byte length.
   * For string encoding streams, this will be the string character length,
   * according to JavaScript's `string.length` logic.
   * For objectMode streams, this is a count of the items waiting to be
   * emitted.
   */
  get bufferLength() {
    return this[BUFFERLENGTH];
  }
  /**
   * The `BufferEncoding` currently in use, or `null`
   */
  get encoding() {
    return this[ENCODING];
  }
  /**
   * @deprecated - This is a read only property
   */
  set encoding(_enc) {
    throw new Error("Encoding must be set at instantiation time");
  }
  /**
   * @deprecated - Encoding may only be set at instantiation time
   */
  setEncoding(_enc) {
    throw new Error("Encoding must be set at instantiation time");
  }
  /**
   * True if this is an objectMode stream
   */
  get objectMode() {
    return this[OBJECTMODE];
  }
  /**
   * @deprecated - This is a read-only property
   */
  set objectMode(_om) {
    throw new Error("objectMode must be set at instantiation time");
  }
  /**
   * true if this is an async stream
   */
  get ["async"]() {
    return this[ASYNC];
  }
  /**
   * Set to true to make this stream async.
   *
   * Once set, it cannot be unset, as this would potentially cause incorrect
   * behavior.  Ie, a sync stream can be made async, but an async stream
   * cannot be safely made sync.
   */
  set ["async"](a) {
    this[ASYNC] = this[ASYNC] || !!a;
  }
  // drop everything and get out of the flow completely
  [ABORT]() {
    this[ABORTED] = true;
    this.emit("abort", this[SIGNAL]?.reason);
    this.destroy(this[SIGNAL]?.reason);
  }
  /**
   * True if the stream has been aborted.
   */
  get aborted() {
    return this[ABORTED];
  }
  /**
   * No-op setter. Stream aborted status is set via the AbortSignal provided
   * in the constructor options.
   */
  set aborted(_) {
  }
  write(chunk, encoding, cb) {
    if (this[ABORTED])
      return false;
    if (this[EOF])
      throw new Error("write after end");
    if (this[DESTROYED]) {
      this.emit("error", Object.assign(new Error("Cannot call write after a stream was destroyed"), { code: "ERR_STREAM_DESTROYED" }));
      return true;
    }
    if (typeof encoding === "function") {
      cb = encoding;
      encoding = "utf8";
    }
    if (!encoding)
      encoding = "utf8";
    const fn = this[ASYNC] ? defer : nodefer;
    if (!this[OBJECTMODE] && !Buffer.isBuffer(chunk)) {
      if (isArrayBufferView(chunk)) {
        chunk = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      } else if (isArrayBufferLike(chunk)) {
        chunk = Buffer.from(chunk);
      } else if (typeof chunk !== "string") {
        throw new Error("Non-contiguous data written to non-objectMode stream");
      }
    }
    if (this[OBJECTMODE]) {
      if (this[FLOWING] && this[BUFFERLENGTH] !== 0)
        this[FLUSH](true);
      if (this[FLOWING])
        this.emit("data", chunk);
      else
        this[BUFFERPUSH](chunk);
      if (this[BUFFERLENGTH] !== 0)
        this.emit("readable");
      if (cb)
        fn(cb);
      return this[FLOWING];
    }
    if (!chunk.length) {
      if (this[BUFFERLENGTH] !== 0)
        this.emit("readable");
      if (cb)
        fn(cb);
      return this[FLOWING];
    }
    if (typeof chunk === "string" && // unless it is a string already ready for us to use
    !(encoding === this[ENCODING] && !this[DECODER]?.lastNeed)) {
      chunk = Buffer.from(chunk, encoding);
    }
    if (Buffer.isBuffer(chunk) && this[ENCODING]) {
      chunk = this[DECODER].write(chunk);
    }
    if (this[FLOWING] && this[BUFFERLENGTH] !== 0)
      this[FLUSH](true);
    if (this[FLOWING])
      this.emit("data", chunk);
    else
      this[BUFFERPUSH](chunk);
    if (this[BUFFERLENGTH] !== 0)
      this.emit("readable");
    if (cb)
      fn(cb);
    return this[FLOWING];
  }
  /**
   * Low-level explicit read method.
   *
   * In objectMode, the argument is ignored, and one item is returned if
   * available.
   *
   * `n` is the number of bytes (or in the case of encoding streams,
   * characters) to consume. If `n` is not provided, then the entire buffer
   * is returned, or `null` is returned if no data is available.
   *
   * If `n` is greater that the amount of data in the internal buffer,
   * then `null` is returned.
   */
  read(n) {
    if (this[DESTROYED])
      return null;
    this[DISCARDED] = false;
    if (this[BUFFERLENGTH] === 0 || n === 0 || n && n > this[BUFFERLENGTH]) {
      this[MAYBE_EMIT_END]();
      return null;
    }
    if (this[OBJECTMODE])
      n = null;
    if (this[BUFFER].length > 1 && !this[OBJECTMODE]) {
      this[BUFFER] = [
        this[ENCODING] ? this[BUFFER].join("") : Buffer.concat(this[BUFFER], this[BUFFERLENGTH])
      ];
    }
    const ret = this[READ](n || null, this[BUFFER][0]);
    this[MAYBE_EMIT_END]();
    return ret;
  }
  [READ](n, chunk) {
    if (this[OBJECTMODE])
      this[BUFFERSHIFT]();
    else {
      const c = chunk;
      if (n === c.length || n === null)
        this[BUFFERSHIFT]();
      else if (typeof c === "string") {
        this[BUFFER][0] = c.slice(n);
        chunk = c.slice(0, n);
        this[BUFFERLENGTH] -= n;
      } else {
        this[BUFFER][0] = c.subarray(n);
        chunk = c.subarray(0, n);
        this[BUFFERLENGTH] -= n;
      }
    }
    this.emit("data", chunk);
    if (!this[BUFFER].length && !this[EOF])
      this.emit("drain");
    return chunk;
  }
  end(chunk, encoding, cb) {
    if (typeof chunk === "function") {
      cb = chunk;
      chunk = void 0;
    }
    if (typeof encoding === "function") {
      cb = encoding;
      encoding = "utf8";
    }
    if (chunk !== void 0)
      this.write(chunk, encoding);
    if (cb)
      this.once("end", cb);
    this[EOF] = true;
    this.writable = false;
    if (this[FLOWING] || !this[PAUSED])
      this[MAYBE_EMIT_END]();
    return this;
  }
  // don't let the internal resume be overwritten
  [RESUME]() {
    if (this[DESTROYED])
      return;
    if (!this[DATALISTENERS] && !this[PIPES].length) {
      this[DISCARDED] = true;
    }
    this[PAUSED] = false;
    this[FLOWING] = true;
    this.emit("resume");
    if (this[BUFFER].length)
      this[FLUSH]();
    else if (this[EOF])
      this[MAYBE_EMIT_END]();
    else
      this.emit("drain");
  }
  /**
   * Resume the stream if it is currently in a paused state
   *
   * If called when there are no pipe destinations or `data` event listeners,
   * this will place the stream in a "discarded" state, where all data will
   * be thrown away. The discarded state is removed if a pipe destination or
   * data handler is added, if pause() is called, or if any synchronous or
   * asynchronous iteration is started.
   */
  resume() {
    return this[RESUME]();
  }
  /**
   * Pause the stream
   */
  pause() {
    this[FLOWING] = false;
    this[PAUSED] = true;
    this[DISCARDED] = false;
  }
  /**
   * true if the stream has been forcibly destroyed
   */
  get destroyed() {
    return this[DESTROYED];
  }
  /**
   * true if the stream is currently in a flowing state, meaning that
   * any writes will be immediately emitted.
   */
  get flowing() {
    return this[FLOWING];
  }
  /**
   * true if the stream is currently in a paused state
   */
  get paused() {
    return this[PAUSED];
  }
  [BUFFERPUSH](chunk) {
    if (this[OBJECTMODE])
      this[BUFFERLENGTH] += 1;
    else
      this[BUFFERLENGTH] += chunk.length;
    this[BUFFER].push(chunk);
  }
  [BUFFERSHIFT]() {
    if (this[OBJECTMODE])
      this[BUFFERLENGTH] -= 1;
    else
      this[BUFFERLENGTH] -= this[BUFFER][0].length;
    return this[BUFFER].shift();
  }
  [FLUSH](noDrain = false) {
    do {
    } while (this[FLUSHCHUNK](this[BUFFERSHIFT]()) && this[BUFFER].length);
    if (!noDrain && !this[BUFFER].length && !this[EOF])
      this.emit("drain");
  }
  [FLUSHCHUNK](chunk) {
    this.emit("data", chunk);
    return this[FLOWING];
  }
  /**
   * Pipe all data emitted by this stream into the destination provided.
   *
   * Triggers the flow of data.
   */
  pipe(dest, opts) {
    if (this[DESTROYED])
      return dest;
    this[DISCARDED] = false;
    const ended = this[EMITTED_END];
    opts = opts || {};
    if (dest === proc.stdout || dest === proc.stderr)
      opts.end = false;
    else
      opts.end = opts.end !== false;
    opts.proxyErrors = !!opts.proxyErrors;
    if (ended) {
      if (opts.end)
        dest.end();
    } else {
      this[PIPES].push(!opts.proxyErrors ? new Pipe(this, dest, opts) : new PipeProxyErrors(this, dest, opts));
      if (this[ASYNC])
        defer(() => this[RESUME]());
      else
        this[RESUME]();
    }
    return dest;
  }
  /**
   * Fully unhook a piped destination stream.
   *
   * If the destination stream was the only consumer of this stream (ie,
   * there are no other piped destinations or `'data'` event listeners)
   * then the flow of data will stop until there is another consumer or
   * {@link Minipass#resume} is explicitly called.
   */
  unpipe(dest) {
    const p = this[PIPES].find((p2) => p2.dest === dest);
    if (p) {
      if (this[PIPES].length === 1) {
        if (this[FLOWING] && this[DATALISTENERS] === 0) {
          this[FLOWING] = false;
        }
        this[PIPES] = [];
      } else
        this[PIPES].splice(this[PIPES].indexOf(p), 1);
      p.unpipe();
    }
  }
  /**
   * Alias for {@link Minipass#on}
   */
  addListener(ev, handler) {
    return this.on(ev, handler);
  }
  /**
   * Mostly identical to `EventEmitter.on`, with the following
   * behavior differences to prevent data loss and unnecessary hangs:
   *
   * - Adding a 'data' event handler will trigger the flow of data
   *
   * - Adding a 'readable' event handler when there is data waiting to be read
   *   will cause 'readable' to be emitted immediately.
   *
   * - Adding an 'endish' event handler ('end', 'finish', etc.) which has
   *   already passed will cause the event to be emitted immediately and all
   *   handlers removed.
   *
   * - Adding an 'error' event handler after an error has been emitted will
   *   cause the event to be re-emitted immediately with the error previously
   *   raised.
   */
  on(ev, handler) {
    const ret = super.on(ev, handler);
    if (ev === "data") {
      this[DISCARDED] = false;
      this[DATALISTENERS]++;
      if (!this[PIPES].length && !this[FLOWING]) {
        this[RESUME]();
      }
    } else if (ev === "readable" && this[BUFFERLENGTH] !== 0) {
      super.emit("readable");
    } else if (isEndish(ev) && this[EMITTED_END]) {
      super.emit(ev);
      this.removeAllListeners(ev);
    } else if (ev === "error" && this[EMITTED_ERROR]) {
      const h = handler;
      if (this[ASYNC])
        defer(() => h.call(this, this[EMITTED_ERROR]));
      else
        h.call(this, this[EMITTED_ERROR]);
    }
    return ret;
  }
  /**
   * Alias for {@link Minipass#off}
   */
  removeListener(ev, handler) {
    return this.off(ev, handler);
  }
  /**
   * Mostly identical to `EventEmitter.off`
   *
   * If a 'data' event handler is removed, and it was the last consumer
   * (ie, there are no pipe destinations or other 'data' event listeners),
   * then the flow of data will stop until there is another consumer or
   * {@link Minipass#resume} is explicitly called.
   */
  off(ev, handler) {
    const ret = super.off(ev, handler);
    if (ev === "data") {
      this[DATALISTENERS] = this.listeners("data").length;
      if (this[DATALISTENERS] === 0 && !this[DISCARDED] && !this[PIPES].length) {
        this[FLOWING] = false;
      }
    }
    return ret;
  }
  /**
   * Mostly identical to `EventEmitter.removeAllListeners`
   *
   * If all 'data' event handlers are removed, and they were the last consumer
   * (ie, there are no pipe destinations), then the flow of data will stop
   * until there is another consumer or {@link Minipass#resume} is explicitly
   * called.
   */
  removeAllListeners(ev) {
    const ret = super.removeAllListeners(ev);
    if (ev === "data" || ev === void 0) {
      this[DATALISTENERS] = 0;
      if (!this[DISCARDED] && !this[PIPES].length) {
        this[FLOWING] = false;
      }
    }
    return ret;
  }
  /**
   * true if the 'end' event has been emitted
   */
  get emittedEnd() {
    return this[EMITTED_END];
  }
  [MAYBE_EMIT_END]() {
    if (!this[EMITTING_END] && !this[EMITTED_END] && !this[DESTROYED] && this[BUFFER].length === 0 && this[EOF]) {
      this[EMITTING_END] = true;
      this.emit("end");
      this.emit("prefinish");
      this.emit("finish");
      if (this[CLOSED])
        this.emit("close");
      this[EMITTING_END] = false;
    }
  }
  /**
   * Mostly identical to `EventEmitter.emit`, with the following
   * behavior differences to prevent data loss and unnecessary hangs:
   *
   * If the stream has been destroyed, and the event is something other
   * than 'close' or 'error', then `false` is returned and no handlers
   * are called.
   *
   * If the event is 'end', and has already been emitted, then the event
   * is ignored. If the stream is in a paused or non-flowing state, then
   * the event will be deferred until data flow resumes. If the stream is
   * async, then handlers will be called on the next tick rather than
   * immediately.
   *
   * If the event is 'close', and 'end' has not yet been emitted, then
   * the event will be deferred until after 'end' is emitted.
   *
   * If the event is 'error', and an AbortSignal was provided for the stream,
   * and there are no listeners, then the event is ignored, matching the
   * behavior of node core streams in the presense of an AbortSignal.
   *
   * If the event is 'finish' or 'prefinish', then all listeners will be
   * removed after emitting the event, to prevent double-firing.
   */
  emit(ev, ...args) {
    const data = args[0];
    if (ev !== "error" && ev !== "close" && ev !== DESTROYED && this[DESTROYED]) {
      return false;
    } else if (ev === "data") {
      return !this[OBJECTMODE] && !data ? false : this[ASYNC] ? (defer(() => this[EMITDATA](data)), true) : this[EMITDATA](data);
    } else if (ev === "end") {
      return this[EMITEND]();
    } else if (ev === "close") {
      this[CLOSED] = true;
      if (!this[EMITTED_END] && !this[DESTROYED])
        return false;
      const ret2 = super.emit("close");
      this.removeAllListeners("close");
      return ret2;
    } else if (ev === "error") {
      this[EMITTED_ERROR] = data;
      super.emit(ERROR, data);
      const ret2 = !this[SIGNAL] || this.listeners("error").length ? super.emit("error", data) : false;
      this[MAYBE_EMIT_END]();
      return ret2;
    } else if (ev === "resume") {
      const ret2 = super.emit("resume");
      this[MAYBE_EMIT_END]();
      return ret2;
    } else if (ev === "finish" || ev === "prefinish") {
      const ret2 = super.emit(ev);
      this.removeAllListeners(ev);
      return ret2;
    }
    const ret = super.emit(ev, ...args);
    this[MAYBE_EMIT_END]();
    return ret;
  }
  [EMITDATA](data) {
    for (const p of this[PIPES]) {
      if (p.dest.write(data) === false)
        this.pause();
    }
    const ret = this[DISCARDED] ? false : super.emit("data", data);
    this[MAYBE_EMIT_END]();
    return ret;
  }
  [EMITEND]() {
    if (this[EMITTED_END])
      return false;
    this[EMITTED_END] = true;
    this.readable = false;
    return this[ASYNC] ? (defer(() => this[EMITEND2]()), true) : this[EMITEND2]();
  }
  [EMITEND2]() {
    if (this[DECODER]) {
      const data = this[DECODER].end();
      if (data) {
        for (const p of this[PIPES]) {
          p.dest.write(data);
        }
        if (!this[DISCARDED])
          super.emit("data", data);
      }
    }
    for (const p of this[PIPES]) {
      p.end();
    }
    const ret = super.emit("end");
    this.removeAllListeners("end");
    return ret;
  }
  /**
   * Return a Promise that resolves to an array of all emitted data once
   * the stream ends.
   */
  async collect() {
    const buf = Object.assign([], {
      dataLength: 0
    });
    if (!this[OBJECTMODE])
      buf.dataLength = 0;
    const p = this.promise();
    this.on("data", (c) => {
      buf.push(c);
      if (!this[OBJECTMODE])
        buf.dataLength += c.length;
    });
    await p;
    return buf;
  }
  /**
   * Return a Promise that resolves to the concatenation of all emitted data
   * once the stream ends.
   *
   * Not allowed on objectMode streams.
   */
  async concat() {
    if (this[OBJECTMODE]) {
      throw new Error("cannot concat in objectMode");
    }
    const buf = await this.collect();
    return this[ENCODING] ? buf.join("") : Buffer.concat(buf, buf.dataLength);
  }
  /**
   * Return a void Promise that resolves once the stream ends.
   */
  async promise() {
    return new Promise((resolve, reject) => {
      this.on(DESTROYED, () => reject(new Error("stream destroyed")));
      this.on("error", (er) => reject(er));
      this.on("end", () => resolve());
    });
  }
  /**
   * Asynchronous `for await of` iteration.
   *
   * This will continue emitting all chunks until the stream terminates.
   */
  [Symbol.asyncIterator]() {
    this[DISCARDED] = false;
    let stopped = false;
    const stop = async () => {
      this.pause();
      stopped = true;
      return { value: void 0, done: true };
    };
    const next = () => {
      if (stopped)
        return stop();
      const res = this.read();
      if (res !== null)
        return Promise.resolve({ done: false, value: res });
      if (this[EOF])
        return stop();
      let resolve;
      let reject;
      const onerr = (er) => {
        this.off("data", ondata);
        this.off("end", onend);
        this.off(DESTROYED, ondestroy);
        stop();
        reject(er);
      };
      const ondata = (value) => {
        this.off("error", onerr);
        this.off("end", onend);
        this.off(DESTROYED, ondestroy);
        this.pause();
        resolve({ value, done: !!this[EOF] });
      };
      const onend = () => {
        this.off("error", onerr);
        this.off("data", ondata);
        this.off(DESTROYED, ondestroy);
        stop();
        resolve({ done: true, value: void 0 });
      };
      const ondestroy = () => onerr(new Error("stream destroyed"));
      return new Promise((res2, rej) => {
        reject = rej;
        resolve = res2;
        this.once(DESTROYED, ondestroy);
        this.once("error", onerr);
        this.once("end", onend);
        this.once("data", ondata);
      });
    };
    return {
      next,
      throw: stop,
      return: stop,
      [Symbol.asyncIterator]() {
        return this;
      }
    };
  }
  /**
   * Synchronous `for of` iteration.
   *
   * The iteration will terminate when the internal buffer runs out, even
   * if the stream has not yet terminated.
   */
  [Symbol.iterator]() {
    this[DISCARDED] = false;
    let stopped = false;
    const stop = () => {
      this.pause();
      this.off(ERROR, stop);
      this.off(DESTROYED, stop);
      this.off("end", stop);
      stopped = true;
      return { done: true, value: void 0 };
    };
    const next = () => {
      if (stopped)
        return stop();
      const value = this.read();
      return value === null ? stop() : { done: false, value };
    };
    this.once("end", stop);
    this.once(ERROR, stop);
    this.once(DESTROYED, stop);
    return {
      next,
      throw: stop,
      return: stop,
      [Symbol.iterator]() {
        return this;
      }
    };
  }
  /**
   * Destroy a stream, preventing it from being used for any further purpose.
   *
   * If the stream has a `close()` method, then it will be called on
   * destruction.
   *
   * After destruction, any attempt to write data, read data, or emit most
   * events will be ignored.
   *
   * If an error argument is provided, then it will be emitted in an
   * 'error' event.
   */
  destroy(er) {
    if (this[DESTROYED]) {
      if (er)
        this.emit("error", er);
      else
        this.emit(DESTROYED);
      return this;
    }
    this[DESTROYED] = true;
    this[DISCARDED] = true;
    this[BUFFER].length = 0;
    this[BUFFERLENGTH] = 0;
    const wc = this;
    if (typeof wc.close === "function" && !this[CLOSED])
      wc.close();
    if (er)
      this.emit("error", er);
    else
      this.emit(DESTROYED);
    return this;
  }
  /**
   * Alias for {@link isStream}
   *
   * Former export location, maintained for backwards compatibility.
   *
   * @deprecated
   */
  static get isStream() {
    return isStream;
  }
};

// ../../node_modules/path-scurry/dist/esm/index.js
var realpathSync = rps.native;
var defaultFS = {
  lstatSync,
  readdir: readdirCB,
  readdirSync,
  readlinkSync,
  realpathSync,
  promises: {
    lstat,
    readdir,
    readlink,
    realpath
  }
};
var fsFromOption = (fsOption) => !fsOption || fsOption === defaultFS || fsOption === actualFS ? defaultFS : {
  ...defaultFS,
  ...fsOption,
  promises: {
    ...defaultFS.promises,
    ...fsOption.promises || {}
  }
};
var uncDriveRegexp = /^\\\\\?\\([a-z]:)\\?$/i;
var uncToDrive = (rootPath) => rootPath.replace(/\//g, "\\").replace(uncDriveRegexp, "$1\\");
var eitherSep = /[\\\/]/;
var UNKNOWN = 0;
var IFIFO = 1;
var IFCHR = 2;
var IFDIR = 4;
var IFBLK = 6;
var IFREG = 8;
var IFLNK = 10;
var IFSOCK = 12;
var IFMT = 15;
var IFMT_UNKNOWN = ~IFMT;
var READDIR_CALLED = 16;
var LSTAT_CALLED = 32;
var ENOTDIR = 64;
var ENOENT = 128;
var ENOREADLINK = 256;
var ENOREALPATH = 512;
var ENOCHILD = ENOTDIR | ENOENT | ENOREALPATH;
var TYPEMASK = 1023;
var entToType = (s) => s.isFile() ? IFREG : s.isDirectory() ? IFDIR : s.isSymbolicLink() ? IFLNK : s.isCharacterDevice() ? IFCHR : s.isBlockDevice() ? IFBLK : s.isSocket() ? IFSOCK : s.isFIFO() ? IFIFO : UNKNOWN;
var normalizeCache = /* @__PURE__ */ new Map();
var normalize = (s) => {
  const c = normalizeCache.get(s);
  if (c)
    return c;
  const n = s.normalize("NFKD");
  normalizeCache.set(s, n);
  return n;
};
var normalizeNocaseCache = /* @__PURE__ */ new Map();
var normalizeNocase = (s) => {
  const c = normalizeNocaseCache.get(s);
  if (c)
    return c;
  const n = normalize(s.toLowerCase());
  normalizeNocaseCache.set(s, n);
  return n;
};
var ResolveCache = class extends LRUCache {
  constructor() {
    super({ max: 256 });
  }
};
var ChildrenCache = class extends LRUCache {
  constructor(maxSize = 16 * 1024) {
    super({
      maxSize,
      // parent + children
      sizeCalculation: (a) => a.length + 1
    });
  }
};
var setAsCwd = Symbol("PathScurry setAsCwd");
var PathBase = class {
  /**
   * the basename of this path
   *
   * **Important**: *always* test the path name against any test string
   * usingthe {@link isNamed} method, and not by directly comparing this
   * string. Otherwise, unicode path strings that the system sees as identical
   * will not be properly treated as the same path, leading to incorrect
   * behavior and possible security issues.
   */
  name;
  /**
   * the Path entry corresponding to the path root.
   *
   * @internal
   */
  root;
  /**
   * All roots found within the current PathScurry family
   *
   * @internal
   */
  roots;
  /**
   * a reference to the parent path, or undefined in the case of root entries
   *
   * @internal
   */
  parent;
  /**
   * boolean indicating whether paths are compared case-insensitively
   * @internal
   */
  nocase;
  /**
   * boolean indicating that this path is the current working directory
   * of the PathScurry collection that contains it.
   */
  isCWD = false;
  // potential default fs override
  #fs;
  // Stats fields
  #dev;
  get dev() {
    return this.#dev;
  }
  #mode;
  get mode() {
    return this.#mode;
  }
  #nlink;
  get nlink() {
    return this.#nlink;
  }
  #uid;
  get uid() {
    return this.#uid;
  }
  #gid;
  get gid() {
    return this.#gid;
  }
  #rdev;
  get rdev() {
    return this.#rdev;
  }
  #blksize;
  get blksize() {
    return this.#blksize;
  }
  #ino;
  get ino() {
    return this.#ino;
  }
  #size;
  get size() {
    return this.#size;
  }
  #blocks;
  get blocks() {
    return this.#blocks;
  }
  #atimeMs;
  get atimeMs() {
    return this.#atimeMs;
  }
  #mtimeMs;
  get mtimeMs() {
    return this.#mtimeMs;
  }
  #ctimeMs;
  get ctimeMs() {
    return this.#ctimeMs;
  }
  #birthtimeMs;
  get birthtimeMs() {
    return this.#birthtimeMs;
  }
  #atime;
  get atime() {
    return this.#atime;
  }
  #mtime;
  get mtime() {
    return this.#mtime;
  }
  #ctime;
  get ctime() {
    return this.#ctime;
  }
  #birthtime;
  get birthtime() {
    return this.#birthtime;
  }
  #matchName;
  #depth;
  #fullpath;
  #fullpathPosix;
  #relative;
  #relativePosix;
  #type;
  #children;
  #linkTarget;
  #realpath;
  /**
   * This property is for compatibility with the Dirent class as of
   * Node v20, where Dirent['parentPath'] refers to the path of the
   * directory that was passed to readdir. For root entries, it's the path
   * to the entry itself.
   */
  get parentPath() {
    return (this.parent || this).fullpath();
  }
  /**
   * Deprecated alias for Dirent['parentPath'] Somewhat counterintuitively,
   * this property refers to the *parent* path, not the path object itself.
   */
  get path() {
    return this.parentPath;
  }
  /**
   * Do not create new Path objects directly.  They should always be accessed
   * via the PathScurry class or other methods on the Path class.
   *
   * @internal
   */
  constructor(name, type = UNKNOWN, root, roots, nocase, children, opts) {
    this.name = name;
    this.#matchName = nocase ? normalizeNocase(name) : normalize(name);
    this.#type = type & TYPEMASK;
    this.nocase = nocase;
    this.roots = roots;
    this.root = root || this;
    this.#children = children;
    this.#fullpath = opts.fullpath;
    this.#relative = opts.relative;
    this.#relativePosix = opts.relativePosix;
    this.parent = opts.parent;
    if (this.parent) {
      this.#fs = this.parent.#fs;
    } else {
      this.#fs = fsFromOption(opts.fs);
    }
  }
  /**
   * Returns the depth of the Path object from its root.
   *
   * For example, a path at `/foo/bar` would have a depth of 2.
   */
  depth() {
    if (this.#depth !== void 0)
      return this.#depth;
    if (!this.parent)
      return this.#depth = 0;
    return this.#depth = this.parent.depth() + 1;
  }
  /**
   * @internal
   */
  childrenCache() {
    return this.#children;
  }
  /**
   * Get the Path object referenced by the string path, resolved from this Path
   */
  resolve(path13) {
    if (!path13) {
      return this;
    }
    const rootPath = this.getRootString(path13);
    const dir = path13.substring(rootPath.length);
    const dirParts = dir.split(this.splitSep);
    const result = rootPath ? this.getRoot(rootPath).#resolveParts(dirParts) : this.#resolveParts(dirParts);
    return result;
  }
  #resolveParts(dirParts) {
    let p = this;
    for (const part of dirParts) {
      p = p.child(part);
    }
    return p;
  }
  /**
   * Returns the cached children Path objects, if still available.  If they
   * have fallen out of the cache, then returns an empty array, and resets the
   * READDIR_CALLED bit, so that future calls to readdir() will require an fs
   * lookup.
   *
   * @internal
   */
  children() {
    const cached = this.#children.get(this);
    if (cached) {
      return cached;
    }
    const children = Object.assign([], { provisional: 0 });
    this.#children.set(this, children);
    this.#type &= ~READDIR_CALLED;
    return children;
  }
  /**
   * Resolves a path portion and returns or creates the child Path.
   *
   * Returns `this` if pathPart is `''` or `'.'`, or `parent` if pathPart is
   * `'..'`.
   *
   * This should not be called directly.  If `pathPart` contains any path
   * separators, it will lead to unsafe undefined behavior.
   *
   * Use `Path.resolve()` instead.
   *
   * @internal
   */
  child(pathPart, opts) {
    if (pathPart === "" || pathPart === ".") {
      return this;
    }
    if (pathPart === "..") {
      return this.parent || this;
    }
    const children = this.children();
    const name = this.nocase ? normalizeNocase(pathPart) : normalize(pathPart);
    for (const p of children) {
      if (p.#matchName === name) {
        return p;
      }
    }
    const s = this.parent ? this.sep : "";
    const fullpath = this.#fullpath ? this.#fullpath + s + pathPart : void 0;
    const pchild = this.newChild(pathPart, UNKNOWN, {
      ...opts,
      parent: this,
      fullpath
    });
    if (!this.canReaddir()) {
      pchild.#type |= ENOENT;
    }
    children.push(pchild);
    return pchild;
  }
  /**
   * The relative path from the cwd. If it does not share an ancestor with
   * the cwd, then this ends up being equivalent to the fullpath()
   */
  relative() {
    if (this.isCWD)
      return "";
    if (this.#relative !== void 0) {
      return this.#relative;
    }
    const name = this.name;
    const p = this.parent;
    if (!p) {
      return this.#relative = this.name;
    }
    const pv = p.relative();
    return pv + (!pv || !p.parent ? "" : this.sep) + name;
  }
  /**
   * The relative path from the cwd, using / as the path separator.
   * If it does not share an ancestor with
   * the cwd, then this ends up being equivalent to the fullpathPosix()
   * On posix systems, this is identical to relative().
   */
  relativePosix() {
    if (this.sep === "/")
      return this.relative();
    if (this.isCWD)
      return "";
    if (this.#relativePosix !== void 0)
      return this.#relativePosix;
    const name = this.name;
    const p = this.parent;
    if (!p) {
      return this.#relativePosix = this.fullpathPosix();
    }
    const pv = p.relativePosix();
    return pv + (!pv || !p.parent ? "" : "/") + name;
  }
  /**
   * The fully resolved path string for this Path entry
   */
  fullpath() {
    if (this.#fullpath !== void 0) {
      return this.#fullpath;
    }
    const name = this.name;
    const p = this.parent;
    if (!p) {
      return this.#fullpath = this.name;
    }
    const pv = p.fullpath();
    const fp = pv + (!p.parent ? "" : this.sep) + name;
    return this.#fullpath = fp;
  }
  /**
   * On platforms other than windows, this is identical to fullpath.
   *
   * On windows, this is overridden to return the forward-slash form of the
   * full UNC path.
   */
  fullpathPosix() {
    if (this.#fullpathPosix !== void 0)
      return this.#fullpathPosix;
    if (this.sep === "/")
      return this.#fullpathPosix = this.fullpath();
    if (!this.parent) {
      const p2 = this.fullpath().replace(/\\/g, "/");
      if (/^[a-z]:\//i.test(p2)) {
        return this.#fullpathPosix = `//?/${p2}`;
      } else {
        return this.#fullpathPosix = p2;
      }
    }
    const p = this.parent;
    const pfpp = p.fullpathPosix();
    const fpp = pfpp + (!pfpp || !p.parent ? "" : "/") + this.name;
    return this.#fullpathPosix = fpp;
  }
  /**
   * Is the Path of an unknown type?
   *
   * Note that we might know *something* about it if there has been a previous
   * filesystem operation, for example that it does not exist, or is not a
   * link, or whether it has child entries.
   */
  isUnknown() {
    return (this.#type & IFMT) === UNKNOWN;
  }
  isType(type) {
    return this[`is${type}`]();
  }
  getType() {
    return this.isUnknown() ? "Unknown" : this.isDirectory() ? "Directory" : this.isFile() ? "File" : this.isSymbolicLink() ? "SymbolicLink" : this.isFIFO() ? "FIFO" : this.isCharacterDevice() ? "CharacterDevice" : this.isBlockDevice() ? "BlockDevice" : (
      /* c8 ignore start */
      this.isSocket() ? "Socket" : "Unknown"
    );
  }
  /**
   * Is the Path a regular file?
   */
  isFile() {
    return (this.#type & IFMT) === IFREG;
  }
  /**
   * Is the Path a directory?
   */
  isDirectory() {
    return (this.#type & IFMT) === IFDIR;
  }
  /**
   * Is the path a character device?
   */
  isCharacterDevice() {
    return (this.#type & IFMT) === IFCHR;
  }
  /**
   * Is the path a block device?
   */
  isBlockDevice() {
    return (this.#type & IFMT) === IFBLK;
  }
  /**
   * Is the path a FIFO pipe?
   */
  isFIFO() {
    return (this.#type & IFMT) === IFIFO;
  }
  /**
   * Is the path a socket?
   */
  isSocket() {
    return (this.#type & IFMT) === IFSOCK;
  }
  /**
   * Is the path a symbolic link?
   */
  isSymbolicLink() {
    return (this.#type & IFLNK) === IFLNK;
  }
  /**
   * Return the entry if it has been subject of a successful lstat, or
   * undefined otherwise.
   *
   * Does not read the filesystem, so an undefined result *could* simply
   * mean that we haven't called lstat on it.
   */
  lstatCached() {
    return this.#type & LSTAT_CALLED ? this : void 0;
  }
  /**
   * Return the cached link target if the entry has been the subject of a
   * successful readlink, or undefined otherwise.
   *
   * Does not read the filesystem, so an undefined result *could* just mean we
   * don't have any cached data. Only use it if you are very sure that a
   * readlink() has been called at some point.
   */
  readlinkCached() {
    return this.#linkTarget;
  }
  /**
   * Returns the cached realpath target if the entry has been the subject
   * of a successful realpath, or undefined otherwise.
   *
   * Does not read the filesystem, so an undefined result *could* just mean we
   * don't have any cached data. Only use it if you are very sure that a
   * realpath() has been called at some point.
   */
  realpathCached() {
    return this.#realpath;
  }
  /**
   * Returns the cached child Path entries array if the entry has been the
   * subject of a successful readdir(), or [] otherwise.
   *
   * Does not read the filesystem, so an empty array *could* just mean we
   * don't have any cached data. Only use it if you are very sure that a
   * readdir() has been called recently enough to still be valid.
   */
  readdirCached() {
    const children = this.children();
    return children.slice(0, children.provisional);
  }
  /**
   * Return true if it's worth trying to readlink.  Ie, we don't (yet) have
   * any indication that readlink will definitely fail.
   *
   * Returns false if the path is known to not be a symlink, if a previous
   * readlink failed, or if the entry does not exist.
   */
  canReadlink() {
    if (this.#linkTarget)
      return true;
    if (!this.parent)
      return false;
    const ifmt = this.#type & IFMT;
    return !(ifmt !== UNKNOWN && ifmt !== IFLNK || this.#type & ENOREADLINK || this.#type & ENOENT);
  }
  /**
   * Return true if readdir has previously been successfully called on this
   * path, indicating that cachedReaddir() is likely valid.
   */
  calledReaddir() {
    return !!(this.#type & READDIR_CALLED);
  }
  /**
   * Returns true if the path is known to not exist. That is, a previous lstat
   * or readdir failed to verify its existence when that would have been
   * expected, or a parent entry was marked either enoent or enotdir.
   */
  isENOENT() {
    return !!(this.#type & ENOENT);
  }
  /**
   * Return true if the path is a match for the given path name.  This handles
   * case sensitivity and unicode normalization.
   *
   * Note: even on case-sensitive systems, it is **not** safe to test the
   * equality of the `.name` property to determine whether a given pathname
   * matches, due to unicode normalization mismatches.
   *
   * Always use this method instead of testing the `path.name` property
   * directly.
   */
  isNamed(n) {
    return !this.nocase ? this.#matchName === normalize(n) : this.#matchName === normalizeNocase(n);
  }
  /**
   * Return the Path object corresponding to the target of a symbolic link.
   *
   * If the Path is not a symbolic link, or if the readlink call fails for any
   * reason, `undefined` is returned.
   *
   * Result is cached, and thus may be outdated if the filesystem is mutated.
   */
  async readlink() {
    const target = this.#linkTarget;
    if (target) {
      return target;
    }
    if (!this.canReadlink()) {
      return void 0;
    }
    if (!this.parent) {
      return void 0;
    }
    try {
      const read = await this.#fs.promises.readlink(this.fullpath());
      const linkTarget = (await this.parent.realpath())?.resolve(read);
      if (linkTarget) {
        return this.#linkTarget = linkTarget;
      }
    } catch (er) {
      this.#readlinkFail(er.code);
      return void 0;
    }
  }
  /**
   * Synchronous {@link PathBase.readlink}
   */
  readlinkSync() {
    const target = this.#linkTarget;
    if (target) {
      return target;
    }
    if (!this.canReadlink()) {
      return void 0;
    }
    if (!this.parent) {
      return void 0;
    }
    try {
      const read = this.#fs.readlinkSync(this.fullpath());
      const linkTarget = this.parent.realpathSync()?.resolve(read);
      if (linkTarget) {
        return this.#linkTarget = linkTarget;
      }
    } catch (er) {
      this.#readlinkFail(er.code);
      return void 0;
    }
  }
  #readdirSuccess(children) {
    this.#type |= READDIR_CALLED;
    for (let p = children.provisional; p < children.length; p++) {
      const c = children[p];
      if (c)
        c.#markENOENT();
    }
  }
  #markENOENT() {
    if (this.#type & ENOENT)
      return;
    this.#type = (this.#type | ENOENT) & IFMT_UNKNOWN;
    this.#markChildrenENOENT();
  }
  #markChildrenENOENT() {
    const children = this.children();
    children.provisional = 0;
    for (const p of children) {
      p.#markENOENT();
    }
  }
  #markENOREALPATH() {
    this.#type |= ENOREALPATH;
    this.#markENOTDIR();
  }
  // save the information when we know the entry is not a dir
  #markENOTDIR() {
    if (this.#type & ENOTDIR)
      return;
    let t = this.#type;
    if ((t & IFMT) === IFDIR)
      t &= IFMT_UNKNOWN;
    this.#type = t | ENOTDIR;
    this.#markChildrenENOENT();
  }
  #readdirFail(code = "") {
    if (code === "ENOTDIR" || code === "EPERM") {
      this.#markENOTDIR();
    } else if (code === "ENOENT") {
      this.#markENOENT();
    } else {
      this.children().provisional = 0;
    }
  }
  #lstatFail(code = "") {
    if (code === "ENOTDIR") {
      const p = this.parent;
      p.#markENOTDIR();
    } else if (code === "ENOENT") {
      this.#markENOENT();
    }
  }
  #readlinkFail(code = "") {
    let ter = this.#type;
    ter |= ENOREADLINK;
    if (code === "ENOENT")
      ter |= ENOENT;
    if (code === "EINVAL" || code === "UNKNOWN") {
      ter &= IFMT_UNKNOWN;
    }
    this.#type = ter;
    if (code === "ENOTDIR" && this.parent) {
      this.parent.#markENOTDIR();
    }
  }
  #readdirAddChild(e, c) {
    return this.#readdirMaybePromoteChild(e, c) || this.#readdirAddNewChild(e, c);
  }
  #readdirAddNewChild(e, c) {
    const type = entToType(e);
    const child = this.newChild(e.name, type, { parent: this });
    const ifmt = child.#type & IFMT;
    if (ifmt !== IFDIR && ifmt !== IFLNK && ifmt !== UNKNOWN) {
      child.#type |= ENOTDIR;
    }
    c.unshift(child);
    c.provisional++;
    return child;
  }
  #readdirMaybePromoteChild(e, c) {
    for (let p = c.provisional; p < c.length; p++) {
      const pchild = c[p];
      const name = this.nocase ? normalizeNocase(e.name) : normalize(e.name);
      if (name !== pchild.#matchName) {
        continue;
      }
      return this.#readdirPromoteChild(e, pchild, p, c);
    }
  }
  #readdirPromoteChild(e, p, index, c) {
    const v = p.name;
    p.#type = p.#type & IFMT_UNKNOWN | entToType(e);
    if (v !== e.name)
      p.name = e.name;
    if (index !== c.provisional) {
      if (index === c.length - 1)
        c.pop();
      else
        c.splice(index, 1);
      c.unshift(p);
    }
    c.provisional++;
    return p;
  }
  /**
   * Call lstat() on this Path, and update all known information that can be
   * determined.
   *
   * Note that unlike `fs.lstat()`, the returned value does not contain some
   * information, such as `mode`, `dev`, `nlink`, and `ino`.  If that
   * information is required, you will need to call `fs.lstat` yourself.
   *
   * If the Path refers to a nonexistent file, or if the lstat call fails for
   * any reason, `undefined` is returned.  Otherwise the updated Path object is
   * returned.
   *
   * Results are cached, and thus may be out of date if the filesystem is
   * mutated.
   */
  async lstat() {
    if ((this.#type & ENOENT) === 0) {
      try {
        this.#applyStat(await this.#fs.promises.lstat(this.fullpath()));
        return this;
      } catch (er) {
        this.#lstatFail(er.code);
      }
    }
  }
  /**
   * synchronous {@link PathBase.lstat}
   */
  lstatSync() {
    if ((this.#type & ENOENT) === 0) {
      try {
        this.#applyStat(this.#fs.lstatSync(this.fullpath()));
        return this;
      } catch (er) {
        this.#lstatFail(er.code);
      }
    }
  }
  #applyStat(st) {
    const { atime, atimeMs, birthtime, birthtimeMs, blksize, blocks, ctime, ctimeMs, dev, gid, ino, mode, mtime, mtimeMs, nlink, rdev, size, uid } = st;
    this.#atime = atime;
    this.#atimeMs = atimeMs;
    this.#birthtime = birthtime;
    this.#birthtimeMs = birthtimeMs;
    this.#blksize = blksize;
    this.#blocks = blocks;
    this.#ctime = ctime;
    this.#ctimeMs = ctimeMs;
    this.#dev = dev;
    this.#gid = gid;
    this.#ino = ino;
    this.#mode = mode;
    this.#mtime = mtime;
    this.#mtimeMs = mtimeMs;
    this.#nlink = nlink;
    this.#rdev = rdev;
    this.#size = size;
    this.#uid = uid;
    const ifmt = entToType(st);
    this.#type = this.#type & IFMT_UNKNOWN | ifmt | LSTAT_CALLED;
    if (ifmt !== UNKNOWN && ifmt !== IFDIR && ifmt !== IFLNK) {
      this.#type |= ENOTDIR;
    }
  }
  #onReaddirCB = [];
  #readdirCBInFlight = false;
  #callOnReaddirCB(children) {
    this.#readdirCBInFlight = false;
    const cbs = this.#onReaddirCB.slice();
    this.#onReaddirCB.length = 0;
    cbs.forEach((cb) => cb(null, children));
  }
  /**
   * Standard node-style callback interface to get list of directory entries.
   *
   * If the Path cannot or does not contain any children, then an empty array
   * is returned.
   *
   * Results are cached, and thus may be out of date if the filesystem is
   * mutated.
   *
   * @param cb The callback called with (er, entries).  Note that the `er`
   * param is somewhat extraneous, as all readdir() errors are handled and
   * simply result in an empty set of entries being returned.
   * @param allowZalgo Boolean indicating that immediately known results should
   * *not* be deferred with `queueMicrotask`. Defaults to `false`. Release
   * zalgo at your peril, the dark pony lord is devious and unforgiving.
   */
  readdirCB(cb, allowZalgo = false) {
    if (!this.canReaddir()) {
      if (allowZalgo)
        cb(null, []);
      else
        queueMicrotask(() => cb(null, []));
      return;
    }
    const children = this.children();
    if (this.calledReaddir()) {
      const c = children.slice(0, children.provisional);
      if (allowZalgo)
        cb(null, c);
      else
        queueMicrotask(() => cb(null, c));
      return;
    }
    this.#onReaddirCB.push(cb);
    if (this.#readdirCBInFlight) {
      return;
    }
    this.#readdirCBInFlight = true;
    const fullpath = this.fullpath();
    this.#fs.readdir(fullpath, { withFileTypes: true }, (er, entries) => {
      if (er) {
        this.#readdirFail(er.code);
        children.provisional = 0;
      } else {
        for (const e of entries) {
          this.#readdirAddChild(e, children);
        }
        this.#readdirSuccess(children);
      }
      this.#callOnReaddirCB(children.slice(0, children.provisional));
      return;
    });
  }
  #asyncReaddirInFlight;
  /**
   * Return an array of known child entries.
   *
   * If the Path cannot or does not contain any children, then an empty array
   * is returned.
   *
   * Results are cached, and thus may be out of date if the filesystem is
   * mutated.
   */
  async readdir() {
    if (!this.canReaddir()) {
      return [];
    }
    const children = this.children();
    if (this.calledReaddir()) {
      return children.slice(0, children.provisional);
    }
    const fullpath = this.fullpath();
    if (this.#asyncReaddirInFlight) {
      await this.#asyncReaddirInFlight;
    } else {
      let resolve = () => {
      };
      this.#asyncReaddirInFlight = new Promise((res) => resolve = res);
      try {
        for (const e of await this.#fs.promises.readdir(fullpath, {
          withFileTypes: true
        })) {
          this.#readdirAddChild(e, children);
        }
        this.#readdirSuccess(children);
      } catch (er) {
        this.#readdirFail(er.code);
        children.provisional = 0;
      }
      this.#asyncReaddirInFlight = void 0;
      resolve();
    }
    return children.slice(0, children.provisional);
  }
  /**
   * synchronous {@link PathBase.readdir}
   */
  readdirSync() {
    if (!this.canReaddir()) {
      return [];
    }
    const children = this.children();
    if (this.calledReaddir()) {
      return children.slice(0, children.provisional);
    }
    const fullpath = this.fullpath();
    try {
      for (const e of this.#fs.readdirSync(fullpath, {
        withFileTypes: true
      })) {
        this.#readdirAddChild(e, children);
      }
      this.#readdirSuccess(children);
    } catch (er) {
      this.#readdirFail(er.code);
      children.provisional = 0;
    }
    return children.slice(0, children.provisional);
  }
  canReaddir() {
    if (this.#type & ENOCHILD)
      return false;
    const ifmt = IFMT & this.#type;
    if (!(ifmt === UNKNOWN || ifmt === IFDIR || ifmt === IFLNK)) {
      return false;
    }
    return true;
  }
  shouldWalk(dirs, walkFilter) {
    return (this.#type & IFDIR) === IFDIR && !(this.#type & ENOCHILD) && !dirs.has(this) && (!walkFilter || walkFilter(this));
  }
  /**
   * Return the Path object corresponding to path as resolved
   * by realpath(3).
   *
   * If the realpath call fails for any reason, `undefined` is returned.
   *
   * Result is cached, and thus may be outdated if the filesystem is mutated.
   * On success, returns a Path object.
   */
  async realpath() {
    if (this.#realpath)
      return this.#realpath;
    if ((ENOREALPATH | ENOREADLINK | ENOENT) & this.#type)
      return void 0;
    try {
      const rp = await this.#fs.promises.realpath(this.fullpath());
      return this.#realpath = this.resolve(rp);
    } catch (_) {
      this.#markENOREALPATH();
    }
  }
  /**
   * Synchronous {@link realpath}
   */
  realpathSync() {
    if (this.#realpath)
      return this.#realpath;
    if ((ENOREALPATH | ENOREADLINK | ENOENT) & this.#type)
      return void 0;
    try {
      const rp = this.#fs.realpathSync(this.fullpath());
      return this.#realpath = this.resolve(rp);
    } catch (_) {
      this.#markENOREALPATH();
    }
  }
  /**
   * Internal method to mark this Path object as the scurry cwd,
   * called by {@link PathScurry#chdir}
   *
   * @internal
   */
  [setAsCwd](oldCwd) {
    if (oldCwd === this)
      return;
    oldCwd.isCWD = false;
    this.isCWD = true;
    const changed = /* @__PURE__ */ new Set([]);
    let rp = [];
    let p = this;
    while (p && p.parent) {
      changed.add(p);
      p.#relative = rp.join(this.sep);
      p.#relativePosix = rp.join("/");
      p = p.parent;
      rp.push("..");
    }
    p = oldCwd;
    while (p && p.parent && !changed.has(p)) {
      p.#relative = void 0;
      p.#relativePosix = void 0;
      p = p.parent;
    }
  }
};
var PathWin32 = class _PathWin32 extends PathBase {
  /**
   * Separator for generating path strings.
   */
  sep = "\\";
  /**
   * Separator for parsing path strings.
   */
  splitSep = eitherSep;
  /**
   * Do not create new Path objects directly.  They should always be accessed
   * via the PathScurry class or other methods on the Path class.
   *
   * @internal
   */
  constructor(name, type = UNKNOWN, root, roots, nocase, children, opts) {
    super(name, type, root, roots, nocase, children, opts);
  }
  /**
   * @internal
   */
  newChild(name, type = UNKNOWN, opts = {}) {
    return new _PathWin32(name, type, this.root, this.roots, this.nocase, this.childrenCache(), opts);
  }
  /**
   * @internal
   */
  getRootString(path13) {
    return win32.parse(path13).root;
  }
  /**
   * @internal
   */
  getRoot(rootPath) {
    rootPath = uncToDrive(rootPath.toUpperCase());
    if (rootPath === this.root.name) {
      return this.root;
    }
    for (const [compare, root] of Object.entries(this.roots)) {
      if (this.sameRoot(rootPath, compare)) {
        return this.roots[rootPath] = root;
      }
    }
    return this.roots[rootPath] = new PathScurryWin32(rootPath, this).root;
  }
  /**
   * @internal
   */
  sameRoot(rootPath, compare = this.root.name) {
    rootPath = rootPath.toUpperCase().replace(/\//g, "\\").replace(uncDriveRegexp, "$1\\");
    return rootPath === compare;
  }
};
var PathPosix = class _PathPosix extends PathBase {
  /**
   * separator for parsing path strings
   */
  splitSep = "/";
  /**
   * separator for generating path strings
   */
  sep = "/";
  /**
   * Do not create new Path objects directly.  They should always be accessed
   * via the PathScurry class or other methods on the Path class.
   *
   * @internal
   */
  constructor(name, type = UNKNOWN, root, roots, nocase, children, opts) {
    super(name, type, root, roots, nocase, children, opts);
  }
  /**
   * @internal
   */
  getRootString(path13) {
    return path13.startsWith("/") ? "/" : "";
  }
  /**
   * @internal
   */
  getRoot(_rootPath) {
    return this.root;
  }
  /**
   * @internal
   */
  newChild(name, type = UNKNOWN, opts = {}) {
    return new _PathPosix(name, type, this.root, this.roots, this.nocase, this.childrenCache(), opts);
  }
};
var PathScurryBase = class {
  /**
   * The root Path entry for the current working directory of this Scurry
   */
  root;
  /**
   * The string path for the root of this Scurry's current working directory
   */
  rootPath;
  /**
   * A collection of all roots encountered, referenced by rootPath
   */
  roots;
  /**
   * The Path entry corresponding to this PathScurry's current working directory.
   */
  cwd;
  #resolveCache;
  #resolvePosixCache;
  #children;
  /**
   * Perform path comparisons case-insensitively.
   *
   * Defaults true on Darwin and Windows systems, false elsewhere.
   */
  nocase;
  #fs;
  /**
   * This class should not be instantiated directly.
   *
   * Use PathScurryWin32, PathScurryDarwin, PathScurryPosix, or PathScurry
   *
   * @internal
   */
  constructor(cwd = process.cwd(), pathImpl, sep2, { nocase, childrenCacheSize = 16 * 1024, fs: fs12 = defaultFS } = {}) {
    this.#fs = fsFromOption(fs12);
    if (cwd instanceof URL || cwd.startsWith("file://")) {
      cwd = fileURLToPath(cwd);
    }
    const cwdPath = pathImpl.resolve(cwd);
    this.roots = /* @__PURE__ */ Object.create(null);
    this.rootPath = this.parseRootPath(cwdPath);
    this.#resolveCache = new ResolveCache();
    this.#resolvePosixCache = new ResolveCache();
    this.#children = new ChildrenCache(childrenCacheSize);
    const split = cwdPath.substring(this.rootPath.length).split(sep2);
    if (split.length === 1 && !split[0]) {
      split.pop();
    }
    if (nocase === void 0) {
      throw new TypeError("must provide nocase setting to PathScurryBase ctor");
    }
    this.nocase = nocase;
    this.root = this.newRoot(this.#fs);
    this.roots[this.rootPath] = this.root;
    let prev = this.root;
    let len = split.length - 1;
    const joinSep = pathImpl.sep;
    let abs = this.rootPath;
    let sawFirst = false;
    for (const part of split) {
      const l = len--;
      prev = prev.child(part, {
        relative: new Array(l).fill("..").join(joinSep),
        relativePosix: new Array(l).fill("..").join("/"),
        fullpath: abs += (sawFirst ? "" : joinSep) + part
      });
      sawFirst = true;
    }
    this.cwd = prev;
  }
  /**
   * Get the depth of a provided path, string, or the cwd
   */
  depth(path13 = this.cwd) {
    if (typeof path13 === "string") {
      path13 = this.cwd.resolve(path13);
    }
    return path13.depth();
  }
  /**
   * Return the cache of child entries.  Exposed so subclasses can create
   * child Path objects in a platform-specific way.
   *
   * @internal
   */
  childrenCache() {
    return this.#children;
  }
  /**
   * Resolve one or more path strings to a resolved string
   *
   * Same interface as require('path').resolve.
   *
   * Much faster than path.resolve() when called multiple times for the same
   * path, because the resolved Path objects are cached.  Much slower
   * otherwise.
   */
  resolve(...paths) {
    let r = "";
    for (let i = paths.length - 1; i >= 0; i--) {
      const p = paths[i];
      if (!p || p === ".")
        continue;
      r = r ? `${p}/${r}` : p;
      if (this.isAbsolute(p)) {
        break;
      }
    }
    const cached = this.#resolveCache.get(r);
    if (cached !== void 0) {
      return cached;
    }
    const result = this.cwd.resolve(r).fullpath();
    this.#resolveCache.set(r, result);
    return result;
  }
  /**
   * Resolve one or more path strings to a resolved string, returning
   * the posix path.  Identical to .resolve() on posix systems, but on
   * windows will return a forward-slash separated UNC path.
   *
   * Same interface as require('path').resolve.
   *
   * Much faster than path.resolve() when called multiple times for the same
   * path, because the resolved Path objects are cached.  Much slower
   * otherwise.
   */
  resolvePosix(...paths) {
    let r = "";
    for (let i = paths.length - 1; i >= 0; i--) {
      const p = paths[i];
      if (!p || p === ".")
        continue;
      r = r ? `${p}/${r}` : p;
      if (this.isAbsolute(p)) {
        break;
      }
    }
    const cached = this.#resolvePosixCache.get(r);
    if (cached !== void 0) {
      return cached;
    }
    const result = this.cwd.resolve(r).fullpathPosix();
    this.#resolvePosixCache.set(r, result);
    return result;
  }
  /**
   * find the relative path from the cwd to the supplied path string or entry
   */
  relative(entry = this.cwd) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    }
    return entry.relative();
  }
  /**
   * find the relative path from the cwd to the supplied path string or
   * entry, using / as the path delimiter, even on Windows.
   */
  relativePosix(entry = this.cwd) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    }
    return entry.relativePosix();
  }
  /**
   * Return the basename for the provided string or Path object
   */
  basename(entry = this.cwd) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    }
    return entry.name;
  }
  /**
   * Return the dirname for the provided string or Path object
   */
  dirname(entry = this.cwd) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    }
    return (entry.parent || entry).fullpath();
  }
  async readdir(entry = this.cwd, opts = {
    withFileTypes: true
  }) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    } else if (!(entry instanceof PathBase)) {
      opts = entry;
      entry = this.cwd;
    }
    const { withFileTypes } = opts;
    if (!entry.canReaddir()) {
      return [];
    } else {
      const p = await entry.readdir();
      return withFileTypes ? p : p.map((e) => e.name);
    }
  }
  readdirSync(entry = this.cwd, opts = {
    withFileTypes: true
  }) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    } else if (!(entry instanceof PathBase)) {
      opts = entry;
      entry = this.cwd;
    }
    const { withFileTypes = true } = opts;
    if (!entry.canReaddir()) {
      return [];
    } else if (withFileTypes) {
      return entry.readdirSync();
    } else {
      return entry.readdirSync().map((e) => e.name);
    }
  }
  /**
   * Call lstat() on the string or Path object, and update all known
   * information that can be determined.
   *
   * Note that unlike `fs.lstat()`, the returned value does not contain some
   * information, such as `mode`, `dev`, `nlink`, and `ino`.  If that
   * information is required, you will need to call `fs.lstat` yourself.
   *
   * If the Path refers to a nonexistent file, or if the lstat call fails for
   * any reason, `undefined` is returned.  Otherwise the updated Path object is
   * returned.
   *
   * Results are cached, and thus may be out of date if the filesystem is
   * mutated.
   */
  async lstat(entry = this.cwd) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    }
    return entry.lstat();
  }
  /**
   * synchronous {@link PathScurryBase.lstat}
   */
  lstatSync(entry = this.cwd) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    }
    return entry.lstatSync();
  }
  async readlink(entry = this.cwd, { withFileTypes } = {
    withFileTypes: false
  }) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    } else if (!(entry instanceof PathBase)) {
      withFileTypes = entry.withFileTypes;
      entry = this.cwd;
    }
    const e = await entry.readlink();
    return withFileTypes ? e : e?.fullpath();
  }
  readlinkSync(entry = this.cwd, { withFileTypes } = {
    withFileTypes: false
  }) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    } else if (!(entry instanceof PathBase)) {
      withFileTypes = entry.withFileTypes;
      entry = this.cwd;
    }
    const e = entry.readlinkSync();
    return withFileTypes ? e : e?.fullpath();
  }
  async realpath(entry = this.cwd, { withFileTypes } = {
    withFileTypes: false
  }) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    } else if (!(entry instanceof PathBase)) {
      withFileTypes = entry.withFileTypes;
      entry = this.cwd;
    }
    const e = await entry.realpath();
    return withFileTypes ? e : e?.fullpath();
  }
  realpathSync(entry = this.cwd, { withFileTypes } = {
    withFileTypes: false
  }) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    } else if (!(entry instanceof PathBase)) {
      withFileTypes = entry.withFileTypes;
      entry = this.cwd;
    }
    const e = entry.realpathSync();
    return withFileTypes ? e : e?.fullpath();
  }
  async walk(entry = this.cwd, opts = {}) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    } else if (!(entry instanceof PathBase)) {
      opts = entry;
      entry = this.cwd;
    }
    const { withFileTypes = true, follow = false, filter: filter2, walkFilter } = opts;
    const results = [];
    if (!filter2 || filter2(entry)) {
      results.push(withFileTypes ? entry : entry.fullpath());
    }
    const dirs = /* @__PURE__ */ new Set();
    const walk = (dir, cb) => {
      dirs.add(dir);
      dir.readdirCB((er, entries) => {
        if (er) {
          return cb(er);
        }
        let len = entries.length;
        if (!len)
          return cb();
        const next = () => {
          if (--len === 0) {
            cb();
          }
        };
        for (const e of entries) {
          if (!filter2 || filter2(e)) {
            results.push(withFileTypes ? e : e.fullpath());
          }
          if (follow && e.isSymbolicLink()) {
            e.realpath().then((r) => r?.isUnknown() ? r.lstat() : r).then((r) => r?.shouldWalk(dirs, walkFilter) ? walk(r, next) : next());
          } else {
            if (e.shouldWalk(dirs, walkFilter)) {
              walk(e, next);
            } else {
              next();
            }
          }
        }
      }, true);
    };
    const start = entry;
    return new Promise((res, rej) => {
      walk(start, (er) => {
        if (er)
          return rej(er);
        res(results);
      });
    });
  }
  walkSync(entry = this.cwd, opts = {}) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    } else if (!(entry instanceof PathBase)) {
      opts = entry;
      entry = this.cwd;
    }
    const { withFileTypes = true, follow = false, filter: filter2, walkFilter } = opts;
    const results = [];
    if (!filter2 || filter2(entry)) {
      results.push(withFileTypes ? entry : entry.fullpath());
    }
    const dirs = /* @__PURE__ */ new Set([entry]);
    for (const dir of dirs) {
      const entries = dir.readdirSync();
      for (const e of entries) {
        if (!filter2 || filter2(e)) {
          results.push(withFileTypes ? e : e.fullpath());
        }
        let r = e;
        if (e.isSymbolicLink()) {
          if (!(follow && (r = e.realpathSync())))
            continue;
          if (r.isUnknown())
            r.lstatSync();
        }
        if (r.shouldWalk(dirs, walkFilter)) {
          dirs.add(r);
        }
      }
    }
    return results;
  }
  /**
   * Support for `for await`
   *
   * Alias for {@link PathScurryBase.iterate}
   *
   * Note: As of Node 19, this is very slow, compared to other methods of
   * walking.  Consider using {@link PathScurryBase.stream} if memory overhead
   * and backpressure are concerns, or {@link PathScurryBase.walk} if not.
   */
  [Symbol.asyncIterator]() {
    return this.iterate();
  }
  iterate(entry = this.cwd, options = {}) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    } else if (!(entry instanceof PathBase)) {
      options = entry;
      entry = this.cwd;
    }
    return this.stream(entry, options)[Symbol.asyncIterator]();
  }
  /**
   * Iterating over a PathScurry performs a synchronous walk.
   *
   * Alias for {@link PathScurryBase.iterateSync}
   */
  [Symbol.iterator]() {
    return this.iterateSync();
  }
  *iterateSync(entry = this.cwd, opts = {}) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    } else if (!(entry instanceof PathBase)) {
      opts = entry;
      entry = this.cwd;
    }
    const { withFileTypes = true, follow = false, filter: filter2, walkFilter } = opts;
    if (!filter2 || filter2(entry)) {
      yield withFileTypes ? entry : entry.fullpath();
    }
    const dirs = /* @__PURE__ */ new Set([entry]);
    for (const dir of dirs) {
      const entries = dir.readdirSync();
      for (const e of entries) {
        if (!filter2 || filter2(e)) {
          yield withFileTypes ? e : e.fullpath();
        }
        let r = e;
        if (e.isSymbolicLink()) {
          if (!(follow && (r = e.realpathSync())))
            continue;
          if (r.isUnknown())
            r.lstatSync();
        }
        if (r.shouldWalk(dirs, walkFilter)) {
          dirs.add(r);
        }
      }
    }
  }
  stream(entry = this.cwd, opts = {}) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    } else if (!(entry instanceof PathBase)) {
      opts = entry;
      entry = this.cwd;
    }
    const { withFileTypes = true, follow = false, filter: filter2, walkFilter } = opts;
    const results = new Minipass({ objectMode: true });
    if (!filter2 || filter2(entry)) {
      results.write(withFileTypes ? entry : entry.fullpath());
    }
    const dirs = /* @__PURE__ */ new Set();
    const queue = [entry];
    let processing = 0;
    const process2 = () => {
      let paused = false;
      while (!paused) {
        const dir = queue.shift();
        if (!dir) {
          if (processing === 0)
            results.end();
          return;
        }
        processing++;
        dirs.add(dir);
        const onReaddir = (er, entries, didRealpaths = false) => {
          if (er)
            return results.emit("error", er);
          if (follow && !didRealpaths) {
            const promises = [];
            for (const e of entries) {
              if (e.isSymbolicLink()) {
                promises.push(e.realpath().then((r) => r?.isUnknown() ? r.lstat() : r));
              }
            }
            if (promises.length) {
              Promise.all(promises).then(() => onReaddir(null, entries, true));
              return;
            }
          }
          for (const e of entries) {
            if (e && (!filter2 || filter2(e))) {
              if (!results.write(withFileTypes ? e : e.fullpath())) {
                paused = true;
              }
            }
          }
          processing--;
          for (const e of entries) {
            const r = e.realpathCached() || e;
            if (r.shouldWalk(dirs, walkFilter)) {
              queue.push(r);
            }
          }
          if (paused && !results.flowing) {
            results.once("drain", process2);
          } else if (!sync2) {
            process2();
          }
        };
        let sync2 = true;
        dir.readdirCB(onReaddir, true);
        sync2 = false;
      }
    };
    process2();
    return results;
  }
  streamSync(entry = this.cwd, opts = {}) {
    if (typeof entry === "string") {
      entry = this.cwd.resolve(entry);
    } else if (!(entry instanceof PathBase)) {
      opts = entry;
      entry = this.cwd;
    }
    const { withFileTypes = true, follow = false, filter: filter2, walkFilter } = opts;
    const results = new Minipass({ objectMode: true });
    const dirs = /* @__PURE__ */ new Set();
    if (!filter2 || filter2(entry)) {
      results.write(withFileTypes ? entry : entry.fullpath());
    }
    const queue = [entry];
    let processing = 0;
    const process2 = () => {
      let paused = false;
      while (!paused) {
        const dir = queue.shift();
        if (!dir) {
          if (processing === 0)
            results.end();
          return;
        }
        processing++;
        dirs.add(dir);
        const entries = dir.readdirSync();
        for (const e of entries) {
          if (!filter2 || filter2(e)) {
            if (!results.write(withFileTypes ? e : e.fullpath())) {
              paused = true;
            }
          }
        }
        processing--;
        for (const e of entries) {
          let r = e;
          if (e.isSymbolicLink()) {
            if (!(follow && (r = e.realpathSync())))
              continue;
            if (r.isUnknown())
              r.lstatSync();
          }
          if (r.shouldWalk(dirs, walkFilter)) {
            queue.push(r);
          }
        }
      }
      if (paused && !results.flowing)
        results.once("drain", process2);
    };
    process2();
    return results;
  }
  chdir(path13 = this.cwd) {
    const oldCwd = this.cwd;
    this.cwd = typeof path13 === "string" ? this.cwd.resolve(path13) : path13;
    this.cwd[setAsCwd](oldCwd);
  }
};
var PathScurryWin32 = class extends PathScurryBase {
  /**
   * separator for generating path strings
   */
  sep = "\\";
  constructor(cwd = process.cwd(), opts = {}) {
    const { nocase = true } = opts;
    super(cwd, win32, "\\", { ...opts, nocase });
    this.nocase = nocase;
    for (let p = this.cwd; p; p = p.parent) {
      p.nocase = this.nocase;
    }
  }
  /**
   * @internal
   */
  parseRootPath(dir) {
    return win32.parse(dir).root.toUpperCase();
  }
  /**
   * @internal
   */
  newRoot(fs12) {
    return new PathWin32(this.rootPath, IFDIR, void 0, this.roots, this.nocase, this.childrenCache(), { fs: fs12 });
  }
  /**
   * Return true if the provided path string is an absolute path
   */
  isAbsolute(p) {
    return p.startsWith("/") || p.startsWith("\\") || /^[a-z]:(\/|\\)/i.test(p);
  }
};
var PathScurryPosix = class extends PathScurryBase {
  /**
   * separator for generating path strings
   */
  sep = "/";
  constructor(cwd = process.cwd(), opts = {}) {
    const { nocase = false } = opts;
    super(cwd, posix, "/", { ...opts, nocase });
    this.nocase = nocase;
  }
  /**
   * @internal
   */
  parseRootPath(_dir) {
    return "/";
  }
  /**
   * @internal
   */
  newRoot(fs12) {
    return new PathPosix(this.rootPath, IFDIR, void 0, this.roots, this.nocase, this.childrenCache(), { fs: fs12 });
  }
  /**
   * Return true if the provided path string is an absolute path
   */
  isAbsolute(p) {
    return p.startsWith("/");
  }
};
var PathScurryDarwin = class extends PathScurryPosix {
  constructor(cwd = process.cwd(), opts = {}) {
    const { nocase = true } = opts;
    super(cwd, { ...opts, nocase });
  }
};
var Path = process.platform === "win32" ? PathWin32 : PathPosix;
var PathScurry = process.platform === "win32" ? PathScurryWin32 : process.platform === "darwin" ? PathScurryDarwin : PathScurryPosix;

// ../core/node_modules/glob/dist/mjs/glob.js
import { fileURLToPath as fileURLToPath2 } from "url";

// ../core/node_modules/glob/dist/mjs/pattern.js
var isPatternList = (pl) => pl.length >= 1;
var isGlobList = (gl) => gl.length >= 1;
var Pattern = class _Pattern {
  #patternList;
  #globList;
  #index;
  length;
  #platform;
  #rest;
  #globString;
  #isDrive;
  #isUNC;
  #isAbsolute;
  #followGlobstar = true;
  constructor(patternList, globList, index, platform) {
    if (!isPatternList(patternList)) {
      throw new TypeError("empty pattern list");
    }
    if (!isGlobList(globList)) {
      throw new TypeError("empty glob list");
    }
    if (globList.length !== patternList.length) {
      throw new TypeError("mismatched pattern list and glob list lengths");
    }
    this.length = patternList.length;
    if (index < 0 || index >= this.length) {
      throw new TypeError("index out of range");
    }
    this.#patternList = patternList;
    this.#globList = globList;
    this.#index = index;
    this.#platform = platform;
    if (this.#index === 0) {
      if (this.isUNC()) {
        const [p0, p1, p2, p3, ...prest] = this.#patternList;
        const [g0, g1, g2, g3, ...grest] = this.#globList;
        if (prest[0] === "") {
          prest.shift();
          grest.shift();
        }
        const p = [p0, p1, p2, p3, ""].join("/");
        const g = [g0, g1, g2, g3, ""].join("/");
        this.#patternList = [p, ...prest];
        this.#globList = [g, ...grest];
        this.length = this.#patternList.length;
      } else if (this.isDrive() || this.isAbsolute()) {
        const [p1, ...prest] = this.#patternList;
        const [g1, ...grest] = this.#globList;
        if (prest[0] === "") {
          prest.shift();
          grest.shift();
        }
        const p = p1 + "/";
        const g = g1 + "/";
        this.#patternList = [p, ...prest];
        this.#globList = [g, ...grest];
        this.length = this.#patternList.length;
      }
    }
  }
  /**
   * The first entry in the parsed list of patterns
   */
  pattern() {
    return this.#patternList[this.#index];
  }
  /**
   * true of if pattern() returns a string
   */
  isString() {
    return typeof this.#patternList[this.#index] === "string";
  }
  /**
   * true of if pattern() returns GLOBSTAR
   */
  isGlobstar() {
    return this.#patternList[this.#index] === GLOBSTAR;
  }
  /**
   * true if pattern() returns a regexp
   */
  isRegExp() {
    return this.#patternList[this.#index] instanceof RegExp;
  }
  /**
   * The /-joined set of glob parts that make up this pattern
   */
  globString() {
    return this.#globString = this.#globString || (this.#index === 0 ? this.isAbsolute() ? this.#globList[0] + this.#globList.slice(1).join("/") : this.#globList.join("/") : this.#globList.slice(this.#index).join("/"));
  }
  /**
   * true if there are more pattern parts after this one
   */
  hasMore() {
    return this.length > this.#index + 1;
  }
  /**
   * The rest of the pattern after this part, or null if this is the end
   */
  rest() {
    if (this.#rest !== void 0)
      return this.#rest;
    if (!this.hasMore())
      return this.#rest = null;
    this.#rest = new _Pattern(this.#patternList, this.#globList, this.#index + 1, this.#platform);
    this.#rest.#isAbsolute = this.#isAbsolute;
    this.#rest.#isUNC = this.#isUNC;
    this.#rest.#isDrive = this.#isDrive;
    return this.#rest;
  }
  /**
   * true if the pattern represents a //unc/path/ on windows
   */
  isUNC() {
    const pl = this.#patternList;
    return this.#isUNC !== void 0 ? this.#isUNC : this.#isUNC = this.#platform === "win32" && this.#index === 0 && pl[0] === "" && pl[1] === "" && typeof pl[2] === "string" && !!pl[2] && typeof pl[3] === "string" && !!pl[3];
  }
  // pattern like C:/...
  // split = ['C:', ...]
  // XXX: would be nice to handle patterns like `c:*` to test the cwd
  // in c: for *, but I don't know of a way to even figure out what that
  // cwd is without actually chdir'ing into it?
  /**
   * True if the pattern starts with a drive letter on Windows
   */
  isDrive() {
    const pl = this.#patternList;
    return this.#isDrive !== void 0 ? this.#isDrive : this.#isDrive = this.#platform === "win32" && this.#index === 0 && this.length > 1 && typeof pl[0] === "string" && /^[a-z]:$/i.test(pl[0]);
  }
  // pattern = '/' or '/...' or '/x/...'
  // split = ['', ''] or ['', ...] or ['', 'x', ...]
  // Drive and UNC both considered absolute on windows
  /**
   * True if the pattern is rooted on an absolute path
   */
  isAbsolute() {
    const pl = this.#patternList;
    return this.#isAbsolute !== void 0 ? this.#isAbsolute : this.#isAbsolute = pl[0] === "" && pl.length > 1 || this.isDrive() || this.isUNC();
  }
  /**
   * consume the root of the pattern, and return it
   */
  root() {
    const p = this.#patternList[0];
    return typeof p === "string" && this.isAbsolute() && this.#index === 0 ? p : "";
  }
  /**
   * Check to see if the current globstar pattern is allowed to follow
   * a symbolic link.
   */
  checkFollowGlobstar() {
    return !(this.#index === 0 || !this.isGlobstar() || !this.#followGlobstar);
  }
  /**
   * Mark that the current globstar pattern is following a symbolic link
   */
  markFollowGlobstar() {
    if (this.#index === 0 || !this.isGlobstar() || !this.#followGlobstar)
      return false;
    this.#followGlobstar = false;
    return true;
  }
};

// ../core/node_modules/minipass/index.mjs
import EE from "events";
import Stream2 from "stream";
import stringdecoder from "string_decoder";
var proc2 = typeof process === "object" && process ? process : {
  stdout: null,
  stderr: null
};
var SD = stringdecoder.StringDecoder;
var EOF2 = Symbol("EOF");
var MAYBE_EMIT_END2 = Symbol("maybeEmitEnd");
var EMITTED_END2 = Symbol("emittedEnd");
var EMITTING_END2 = Symbol("emittingEnd");
var EMITTED_ERROR2 = Symbol("emittedError");
var CLOSED2 = Symbol("closed");
var READ2 = Symbol("read");
var FLUSH2 = Symbol("flush");
var FLUSHCHUNK2 = Symbol("flushChunk");
var ENCODING2 = Symbol("encoding");
var DECODER2 = Symbol("decoder");
var FLOWING2 = Symbol("flowing");
var PAUSED2 = Symbol("paused");
var RESUME2 = Symbol("resume");
var BUFFER2 = Symbol("buffer");
var PIPES2 = Symbol("pipes");
var BUFFERLENGTH2 = Symbol("bufferLength");
var BUFFERPUSH2 = Symbol("bufferPush");
var BUFFERSHIFT2 = Symbol("bufferShift");
var OBJECTMODE2 = Symbol("objectMode");
var DESTROYED2 = Symbol("destroyed");
var ERROR2 = Symbol("error");
var EMITDATA2 = Symbol("emitData");
var EMITEND3 = Symbol("emitEnd");
var EMITEND22 = Symbol("emitEnd2");
var ASYNC2 = Symbol("async");
var ABORT2 = Symbol("abort");
var ABORTED2 = Symbol("aborted");
var SIGNAL2 = Symbol("signal");
var defer2 = (fn) => Promise.resolve().then(fn);
var doIter = global._MP_NO_ITERATOR_SYMBOLS_ !== "1";
var ASYNCITERATOR = doIter && Symbol.asyncIterator || Symbol("asyncIterator not implemented");
var ITERATOR = doIter && Symbol.iterator || Symbol("iterator not implemented");
var isEndish2 = (ev) => ev === "end" || ev === "finish" || ev === "prefinish";
var isArrayBuffer = (b) => b instanceof ArrayBuffer || typeof b === "object" && b.constructor && b.constructor.name === "ArrayBuffer" && b.byteLength >= 0;
var isArrayBufferView2 = (b) => !Buffer.isBuffer(b) && ArrayBuffer.isView(b);
var Pipe2 = class {
  constructor(src, dest, opts) {
    this.src = src;
    this.dest = dest;
    this.opts = opts;
    this.ondrain = () => src[RESUME2]();
    dest.on("drain", this.ondrain);
  }
  unpipe() {
    this.dest.removeListener("drain", this.ondrain);
  }
  // istanbul ignore next - only here for the prototype
  proxyErrors() {
  }
  end() {
    this.unpipe();
    if (this.opts.end) this.dest.end();
  }
};
var PipeProxyErrors2 = class extends Pipe2 {
  unpipe() {
    this.src.removeListener("error", this.proxyErrors);
    super.unpipe();
  }
  constructor(src, dest, opts) {
    super(src, dest, opts);
    this.proxyErrors = (er) => dest.emit("error", er);
    src.on("error", this.proxyErrors);
  }
};
var Minipass2 = class _Minipass extends Stream2 {
  constructor(options) {
    super();
    this[FLOWING2] = false;
    this[PAUSED2] = false;
    this[PIPES2] = [];
    this[BUFFER2] = [];
    this[OBJECTMODE2] = options && options.objectMode || false;
    if (this[OBJECTMODE2]) this[ENCODING2] = null;
    else this[ENCODING2] = options && options.encoding || null;
    if (this[ENCODING2] === "buffer") this[ENCODING2] = null;
    this[ASYNC2] = options && !!options.async || false;
    this[DECODER2] = this[ENCODING2] ? new SD(this[ENCODING2]) : null;
    this[EOF2] = false;
    this[EMITTED_END2] = false;
    this[EMITTING_END2] = false;
    this[CLOSED2] = false;
    this[EMITTED_ERROR2] = null;
    this.writable = true;
    this.readable = true;
    this[BUFFERLENGTH2] = 0;
    this[DESTROYED2] = false;
    if (options && options.debugExposeBuffer === true) {
      Object.defineProperty(this, "buffer", { get: () => this[BUFFER2] });
    }
    if (options && options.debugExposePipes === true) {
      Object.defineProperty(this, "pipes", { get: () => this[PIPES2] });
    }
    this[SIGNAL2] = options && options.signal;
    this[ABORTED2] = false;
    if (this[SIGNAL2]) {
      this[SIGNAL2].addEventListener("abort", () => this[ABORT2]());
      if (this[SIGNAL2].aborted) {
        this[ABORT2]();
      }
    }
  }
  get bufferLength() {
    return this[BUFFERLENGTH2];
  }
  get encoding() {
    return this[ENCODING2];
  }
  set encoding(enc) {
    if (this[OBJECTMODE2]) throw new Error("cannot set encoding in objectMode");
    if (this[ENCODING2] && enc !== this[ENCODING2] && (this[DECODER2] && this[DECODER2].lastNeed || this[BUFFERLENGTH2]))
      throw new Error("cannot change encoding");
    if (this[ENCODING2] !== enc) {
      this[DECODER2] = enc ? new SD(enc) : null;
      if (this[BUFFER2].length)
        this[BUFFER2] = this[BUFFER2].map((chunk) => this[DECODER2].write(chunk));
    }
    this[ENCODING2] = enc;
  }
  setEncoding(enc) {
    this.encoding = enc;
  }
  get objectMode() {
    return this[OBJECTMODE2];
  }
  set objectMode(om) {
    this[OBJECTMODE2] = this[OBJECTMODE2] || !!om;
  }
  get ["async"]() {
    return this[ASYNC2];
  }
  set ["async"](a) {
    this[ASYNC2] = this[ASYNC2] || !!a;
  }
  // drop everything and get out of the flow completely
  [ABORT2]() {
    this[ABORTED2] = true;
    this.emit("abort", this[SIGNAL2].reason);
    this.destroy(this[SIGNAL2].reason);
  }
  get aborted() {
    return this[ABORTED2];
  }
  set aborted(_) {
  }
  write(chunk, encoding, cb) {
    if (this[ABORTED2]) return false;
    if (this[EOF2]) throw new Error("write after end");
    if (this[DESTROYED2]) {
      this.emit(
        "error",
        Object.assign(
          new Error("Cannot call write after a stream was destroyed"),
          { code: "ERR_STREAM_DESTROYED" }
        )
      );
      return true;
    }
    if (typeof encoding === "function") cb = encoding, encoding = "utf8";
    if (!encoding) encoding = "utf8";
    const fn = this[ASYNC2] ? defer2 : (f) => f();
    if (!this[OBJECTMODE2] && !Buffer.isBuffer(chunk)) {
      if (isArrayBufferView2(chunk))
        chunk = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      else if (isArrayBuffer(chunk)) chunk = Buffer.from(chunk);
      else if (typeof chunk !== "string")
        this.objectMode = true;
    }
    if (this[OBJECTMODE2]) {
      if (this.flowing && this[BUFFERLENGTH2] !== 0) this[FLUSH2](true);
      if (this.flowing) this.emit("data", chunk);
      else this[BUFFERPUSH2](chunk);
      if (this[BUFFERLENGTH2] !== 0) this.emit("readable");
      if (cb) fn(cb);
      return this.flowing;
    }
    if (!chunk.length) {
      if (this[BUFFERLENGTH2] !== 0) this.emit("readable");
      if (cb) fn(cb);
      return this.flowing;
    }
    if (typeof chunk === "string" && // unless it is a string already ready for us to use
    !(encoding === this[ENCODING2] && !this[DECODER2].lastNeed)) {
      chunk = Buffer.from(chunk, encoding);
    }
    if (Buffer.isBuffer(chunk) && this[ENCODING2])
      chunk = this[DECODER2].write(chunk);
    if (this.flowing && this[BUFFERLENGTH2] !== 0) this[FLUSH2](true);
    if (this.flowing) this.emit("data", chunk);
    else this[BUFFERPUSH2](chunk);
    if (this[BUFFERLENGTH2] !== 0) this.emit("readable");
    if (cb) fn(cb);
    return this.flowing;
  }
  read(n) {
    if (this[DESTROYED2]) return null;
    if (this[BUFFERLENGTH2] === 0 || n === 0 || n > this[BUFFERLENGTH2]) {
      this[MAYBE_EMIT_END2]();
      return null;
    }
    if (this[OBJECTMODE2]) n = null;
    if (this[BUFFER2].length > 1 && !this[OBJECTMODE2]) {
      if (this.encoding) this[BUFFER2] = [this[BUFFER2].join("")];
      else this[BUFFER2] = [Buffer.concat(this[BUFFER2], this[BUFFERLENGTH2])];
    }
    const ret = this[READ2](n || null, this[BUFFER2][0]);
    this[MAYBE_EMIT_END2]();
    return ret;
  }
  [READ2](n, chunk) {
    if (n === chunk.length || n === null) this[BUFFERSHIFT2]();
    else {
      this[BUFFER2][0] = chunk.slice(n);
      chunk = chunk.slice(0, n);
      this[BUFFERLENGTH2] -= n;
    }
    this.emit("data", chunk);
    if (!this[BUFFER2].length && !this[EOF2]) this.emit("drain");
    return chunk;
  }
  end(chunk, encoding, cb) {
    if (typeof chunk === "function") cb = chunk, chunk = null;
    if (typeof encoding === "function") cb = encoding, encoding = "utf8";
    if (chunk) this.write(chunk, encoding);
    if (cb) this.once("end", cb);
    this[EOF2] = true;
    this.writable = false;
    if (this.flowing || !this[PAUSED2]) this[MAYBE_EMIT_END2]();
    return this;
  }
  // don't let the internal resume be overwritten
  [RESUME2]() {
    if (this[DESTROYED2]) return;
    this[PAUSED2] = false;
    this[FLOWING2] = true;
    this.emit("resume");
    if (this[BUFFER2].length) this[FLUSH2]();
    else if (this[EOF2]) this[MAYBE_EMIT_END2]();
    else this.emit("drain");
  }
  resume() {
    return this[RESUME2]();
  }
  pause() {
    this[FLOWING2] = false;
    this[PAUSED2] = true;
  }
  get destroyed() {
    return this[DESTROYED2];
  }
  get flowing() {
    return this[FLOWING2];
  }
  get paused() {
    return this[PAUSED2];
  }
  [BUFFERPUSH2](chunk) {
    if (this[OBJECTMODE2]) this[BUFFERLENGTH2] += 1;
    else this[BUFFERLENGTH2] += chunk.length;
    this[BUFFER2].push(chunk);
  }
  [BUFFERSHIFT2]() {
    if (this[OBJECTMODE2]) this[BUFFERLENGTH2] -= 1;
    else this[BUFFERLENGTH2] -= this[BUFFER2][0].length;
    return this[BUFFER2].shift();
  }
  [FLUSH2](noDrain) {
    do {
    } while (this[FLUSHCHUNK2](this[BUFFERSHIFT2]()) && this[BUFFER2].length);
    if (!noDrain && !this[BUFFER2].length && !this[EOF2]) this.emit("drain");
  }
  [FLUSHCHUNK2](chunk) {
    this.emit("data", chunk);
    return this.flowing;
  }
  pipe(dest, opts) {
    if (this[DESTROYED2]) return;
    const ended = this[EMITTED_END2];
    opts = opts || {};
    if (dest === proc2.stdout || dest === proc2.stderr) opts.end = false;
    else opts.end = opts.end !== false;
    opts.proxyErrors = !!opts.proxyErrors;
    if (ended) {
      if (opts.end) dest.end();
    } else {
      this[PIPES2].push(
        !opts.proxyErrors ? new Pipe2(this, dest, opts) : new PipeProxyErrors2(this, dest, opts)
      );
      if (this[ASYNC2]) defer2(() => this[RESUME2]());
      else this[RESUME2]();
    }
    return dest;
  }
  unpipe(dest) {
    const p = this[PIPES2].find((p2) => p2.dest === dest);
    if (p) {
      this[PIPES2].splice(this[PIPES2].indexOf(p), 1);
      p.unpipe();
    }
  }
  addListener(ev, fn) {
    return this.on(ev, fn);
  }
  on(ev, fn) {
    const ret = super.on(ev, fn);
    if (ev === "data" && !this[PIPES2].length && !this.flowing) this[RESUME2]();
    else if (ev === "readable" && this[BUFFERLENGTH2] !== 0)
      super.emit("readable");
    else if (isEndish2(ev) && this[EMITTED_END2]) {
      super.emit(ev);
      this.removeAllListeners(ev);
    } else if (ev === "error" && this[EMITTED_ERROR2]) {
      if (this[ASYNC2]) defer2(() => fn.call(this, this[EMITTED_ERROR2]));
      else fn.call(this, this[EMITTED_ERROR2]);
    }
    return ret;
  }
  get emittedEnd() {
    return this[EMITTED_END2];
  }
  [MAYBE_EMIT_END2]() {
    if (!this[EMITTING_END2] && !this[EMITTED_END2] && !this[DESTROYED2] && this[BUFFER2].length === 0 && this[EOF2]) {
      this[EMITTING_END2] = true;
      this.emit("end");
      this.emit("prefinish");
      this.emit("finish");
      if (this[CLOSED2]) this.emit("close");
      this[EMITTING_END2] = false;
    }
  }
  emit(ev, data, ...extra) {
    if (ev !== "error" && ev !== "close" && ev !== DESTROYED2 && this[DESTROYED2])
      return;
    else if (ev === "data") {
      return !this[OBJECTMODE2] && !data ? false : this[ASYNC2] ? defer2(() => this[EMITDATA2](data)) : this[EMITDATA2](data);
    } else if (ev === "end") {
      return this[EMITEND3]();
    } else if (ev === "close") {
      this[CLOSED2] = true;
      if (!this[EMITTED_END2] && !this[DESTROYED2]) return;
      const ret2 = super.emit("close");
      this.removeAllListeners("close");
      return ret2;
    } else if (ev === "error") {
      this[EMITTED_ERROR2] = data;
      super.emit(ERROR2, data);
      const ret2 = !this[SIGNAL2] || this.listeners("error").length ? super.emit("error", data) : false;
      this[MAYBE_EMIT_END2]();
      return ret2;
    } else if (ev === "resume") {
      const ret2 = super.emit("resume");
      this[MAYBE_EMIT_END2]();
      return ret2;
    } else if (ev === "finish" || ev === "prefinish") {
      const ret2 = super.emit(ev);
      this.removeAllListeners(ev);
      return ret2;
    }
    const ret = super.emit(ev, data, ...extra);
    this[MAYBE_EMIT_END2]();
    return ret;
  }
  [EMITDATA2](data) {
    for (const p of this[PIPES2]) {
      if (p.dest.write(data) === false) this.pause();
    }
    const ret = super.emit("data", data);
    this[MAYBE_EMIT_END2]();
    return ret;
  }
  [EMITEND3]() {
    if (this[EMITTED_END2]) return;
    this[EMITTED_END2] = true;
    this.readable = false;
    if (this[ASYNC2]) defer2(() => this[EMITEND22]());
    else this[EMITEND22]();
  }
  [EMITEND22]() {
    if (this[DECODER2]) {
      const data = this[DECODER2].end();
      if (data) {
        for (const p of this[PIPES2]) {
          p.dest.write(data);
        }
        super.emit("data", data);
      }
    }
    for (const p of this[PIPES2]) {
      p.end();
    }
    const ret = super.emit("end");
    this.removeAllListeners("end");
    return ret;
  }
  // const all = await stream.collect()
  collect() {
    const buf = [];
    if (!this[OBJECTMODE2]) buf.dataLength = 0;
    const p = this.promise();
    this.on("data", (c) => {
      buf.push(c);
      if (!this[OBJECTMODE2]) buf.dataLength += c.length;
    });
    return p.then(() => buf);
  }
  // const data = await stream.concat()
  concat() {
    return this[OBJECTMODE2] ? Promise.reject(new Error("cannot concat in objectMode")) : this.collect().then(
      (buf) => this[OBJECTMODE2] ? Promise.reject(new Error("cannot concat in objectMode")) : this[ENCODING2] ? buf.join("") : Buffer.concat(buf, buf.dataLength)
    );
  }
  // stream.promise().then(() => done, er => emitted error)
  promise() {
    return new Promise((resolve, reject) => {
      this.on(DESTROYED2, () => reject(new Error("stream destroyed")));
      this.on("error", (er) => reject(er));
      this.on("end", () => resolve());
    });
  }
  // for await (let chunk of stream)
  [ASYNCITERATOR]() {
    let stopped = false;
    const stop = () => {
      this.pause();
      stopped = true;
      return Promise.resolve({ done: true });
    };
    const next = () => {
      if (stopped) return stop();
      const res = this.read();
      if (res !== null) return Promise.resolve({ done: false, value: res });
      if (this[EOF2]) return stop();
      let resolve = null;
      let reject = null;
      const onerr = (er) => {
        this.removeListener("data", ondata);
        this.removeListener("end", onend);
        this.removeListener(DESTROYED2, ondestroy);
        stop();
        reject(er);
      };
      const ondata = (value) => {
        this.removeListener("error", onerr);
        this.removeListener("end", onend);
        this.removeListener(DESTROYED2, ondestroy);
        this.pause();
        resolve({ value, done: !!this[EOF2] });
      };
      const onend = () => {
        this.removeListener("error", onerr);
        this.removeListener("data", ondata);
        this.removeListener(DESTROYED2, ondestroy);
        stop();
        resolve({ done: true });
      };
      const ondestroy = () => onerr(new Error("stream destroyed"));
      return new Promise((res2, rej) => {
        reject = rej;
        resolve = res2;
        this.once(DESTROYED2, ondestroy);
        this.once("error", onerr);
        this.once("end", onend);
        this.once("data", ondata);
      });
    };
    return {
      next,
      throw: stop,
      return: stop,
      [ASYNCITERATOR]() {
        return this;
      }
    };
  }
  // for (let chunk of stream)
  [ITERATOR]() {
    let stopped = false;
    const stop = () => {
      this.pause();
      this.removeListener(ERROR2, stop);
      this.removeListener(DESTROYED2, stop);
      this.removeListener("end", stop);
      stopped = true;
      return { done: true };
    };
    const next = () => {
      if (stopped) return stop();
      const value = this.read();
      return value === null ? stop() : { value };
    };
    this.once("end", stop);
    this.once(ERROR2, stop);
    this.once(DESTROYED2, stop);
    return {
      next,
      throw: stop,
      return: stop,
      [ITERATOR]() {
        return this;
      }
    };
  }
  destroy(er) {
    if (this[DESTROYED2]) {
      if (er) this.emit("error", er);
      else this.emit(DESTROYED2);
      return this;
    }
    this[DESTROYED2] = true;
    this[BUFFER2].length = 0;
    this[BUFFERLENGTH2] = 0;
    if (typeof this.close === "function" && !this[CLOSED2]) this.close();
    if (er) this.emit("error", er);
    else this.emit(DESTROYED2);
    return this;
  }
  static isStream(s) {
    return !!s && (s instanceof _Minipass || s instanceof Stream2 || s instanceof EE && // readable
    (typeof s.pipe === "function" || // writable
    typeof s.write === "function" && typeof s.end === "function"));
  }
};

// ../core/node_modules/glob/dist/mjs/ignore.js
var defaultPlatform2 = typeof process === "object" && process && typeof process.platform === "string" ? process.platform : "linux";
var Ignore = class {
  relative;
  relativeChildren;
  absolute;
  absoluteChildren;
  constructor(ignored, { nobrace, nocase, noext, noglobstar, platform = defaultPlatform2 }) {
    this.relative = [];
    this.absolute = [];
    this.relativeChildren = [];
    this.absoluteChildren = [];
    const mmopts = {
      dot: true,
      nobrace,
      nocase,
      noext,
      noglobstar,
      optimizationLevel: 2,
      platform,
      nocomment: true,
      nonegate: true
    };
    for (const ign of ignored) {
      const mm = new Minimatch(ign, mmopts);
      for (let i = 0; i < mm.set.length; i++) {
        const parsed = mm.set[i];
        const globParts = mm.globParts[i];
        const p = new Pattern(parsed, globParts, 0, platform);
        const m = new Minimatch(p.globString(), mmopts);
        const children = globParts[globParts.length - 1] === "**";
        const absolute = p.isAbsolute();
        if (absolute)
          this.absolute.push(m);
        else
          this.relative.push(m);
        if (children) {
          if (absolute)
            this.absoluteChildren.push(m);
          else
            this.relativeChildren.push(m);
        }
      }
    }
  }
  ignored(p) {
    const fullpath = p.fullpath();
    const fullpaths = `${fullpath}/`;
    const relative = p.relative() || ".";
    const relatives = `${relative}/`;
    for (const m of this.relative) {
      if (m.match(relative) || m.match(relatives))
        return true;
    }
    for (const m of this.absolute) {
      if (m.match(fullpath) || m.match(fullpaths))
        return true;
    }
    return false;
  }
  childrenIgnored(p) {
    const fullpath = p.fullpath() + "/";
    const relative = (p.relative() || ".") + "/";
    for (const m of this.relativeChildren) {
      if (m.match(relative))
        return true;
    }
    for (const m of this.absoluteChildren) {
      if (m.match(fullpath))
        true;
    }
    return false;
  }
};

// ../core/node_modules/glob/dist/mjs/processor.js
var HasWalkedCache = class _HasWalkedCache {
  store;
  constructor(store = /* @__PURE__ */ new Map()) {
    this.store = store;
  }
  copy() {
    return new _HasWalkedCache(new Map(this.store));
  }
  hasWalked(target, pattern) {
    return this.store.get(target.fullpath())?.has(pattern.globString());
  }
  storeWalked(target, pattern) {
    const fullpath = target.fullpath();
    const cached = this.store.get(fullpath);
    if (cached)
      cached.add(pattern.globString());
    else
      this.store.set(fullpath, /* @__PURE__ */ new Set([pattern.globString()]));
  }
};
var MatchRecord = class {
  store = /* @__PURE__ */ new Map();
  add(target, absolute, ifDir) {
    const n = (absolute ? 2 : 0) | (ifDir ? 1 : 0);
    const current = this.store.get(target);
    this.store.set(target, current === void 0 ? n : n & current);
  }
  // match, absolute, ifdir
  entries() {
    return [...this.store.entries()].map(([path13, n]) => [
      path13,
      !!(n & 2),
      !!(n & 1)
    ]);
  }
};
var SubWalks = class {
  store = /* @__PURE__ */ new Map();
  add(target, pattern) {
    if (!target.canReaddir()) {
      return;
    }
    const subs = this.store.get(target);
    if (subs) {
      if (!subs.find((p) => p.globString() === pattern.globString())) {
        subs.push(pattern);
      }
    } else
      this.store.set(target, [pattern]);
  }
  get(target) {
    const subs = this.store.get(target);
    if (!subs) {
      throw new Error("attempting to walk unknown path");
    }
    return subs;
  }
  entries() {
    return this.keys().map((k) => [k, this.store.get(k)]);
  }
  keys() {
    return [...this.store.keys()].filter((t) => t.canReaddir());
  }
};
var Processor = class _Processor {
  hasWalkedCache;
  matches = new MatchRecord();
  subwalks = new SubWalks();
  patterns;
  follow;
  dot;
  opts;
  constructor(opts, hasWalkedCache) {
    this.opts = opts;
    this.follow = !!opts.follow;
    this.dot = !!opts.dot;
    this.hasWalkedCache = hasWalkedCache ? hasWalkedCache.copy() : new HasWalkedCache();
  }
  processPatterns(target, patterns) {
    this.patterns = patterns;
    const processingSet = patterns.map((p) => [target, p]);
    for (let [t, pattern] of processingSet) {
      this.hasWalkedCache.storeWalked(t, pattern);
      const root = pattern.root();
      const absolute = pattern.isAbsolute() && this.opts.absolute !== false;
      if (root) {
        t = t.resolve(root === "/" && this.opts.root !== void 0 ? this.opts.root : root);
        const rest2 = pattern.rest();
        if (!rest2) {
          this.matches.add(t, true, false);
          continue;
        } else {
          pattern = rest2;
        }
      }
      if (t.isENOENT())
        continue;
      let p;
      let rest;
      let changed = false;
      while (typeof (p = pattern.pattern()) === "string" && (rest = pattern.rest())) {
        const c = t.resolve(p);
        if (c.isUnknown() && p !== "..")
          break;
        t = c;
        pattern = rest;
        changed = true;
      }
      p = pattern.pattern();
      rest = pattern.rest();
      if (changed) {
        if (this.hasWalkedCache.hasWalked(t, pattern))
          continue;
        this.hasWalkedCache.storeWalked(t, pattern);
      }
      if (typeof p === "string") {
        if (!rest) {
          const ifDir = p === ".." || p === "" || p === ".";
          this.matches.add(t.resolve(p), absolute, ifDir);
        } else {
          this.subwalks.add(t, pattern);
        }
        continue;
      } else if (p === GLOBSTAR) {
        if (!t.isSymbolicLink() || this.follow || pattern.checkFollowGlobstar()) {
          this.subwalks.add(t, pattern);
        }
        const rp = rest?.pattern();
        const rrest = rest?.rest();
        if (!rest || (rp === "" || rp === ".") && !rrest) {
          this.matches.add(t, absolute, rp === "" || rp === ".");
        } else {
          if (rp === "..") {
            const tp = t.parent || t;
            if (!rrest)
              this.matches.add(tp, absolute, true);
            else if (!this.hasWalkedCache.hasWalked(tp, rrest)) {
              this.subwalks.add(tp, rrest);
            }
          }
        }
      } else if (p instanceof RegExp) {
        this.subwalks.add(t, pattern);
      }
    }
    return this;
  }
  subwalkTargets() {
    return this.subwalks.keys();
  }
  child() {
    return new _Processor(this.opts, this.hasWalkedCache);
  }
  // return a new Processor containing the subwalks for each
  // child entry, and a set of matches, and
  // a hasWalkedCache that's a copy of this one
  // then we're going to call
  filterEntries(parent, entries) {
    const patterns = this.subwalks.get(parent);
    const results = this.child();
    for (const e of entries) {
      for (const pattern of patterns) {
        const absolute = pattern.isAbsolute();
        const p = pattern.pattern();
        const rest = pattern.rest();
        if (p === GLOBSTAR) {
          results.testGlobstar(e, pattern, rest, absolute);
        } else if (p instanceof RegExp) {
          results.testRegExp(e, p, rest, absolute);
        } else {
          results.testString(e, p, rest, absolute);
        }
      }
    }
    return results;
  }
  testGlobstar(e, pattern, rest, absolute) {
    if (this.dot || !e.name.startsWith(".")) {
      if (!pattern.hasMore()) {
        this.matches.add(e, absolute, false);
      }
      if (e.canReaddir()) {
        if (this.follow || !e.isSymbolicLink()) {
          this.subwalks.add(e, pattern);
        } else if (e.isSymbolicLink()) {
          if (rest && pattern.checkFollowGlobstar()) {
            this.subwalks.add(e, rest);
          } else if (pattern.markFollowGlobstar()) {
            this.subwalks.add(e, pattern);
          }
        }
      }
    }
    if (rest) {
      const rp = rest.pattern();
      if (typeof rp === "string" && // dots and empty were handled already
      rp !== ".." && rp !== "" && rp !== ".") {
        this.testString(e, rp, rest.rest(), absolute);
      } else if (rp === "..") {
        const ep = e.parent || e;
        this.subwalks.add(ep, rest);
      } else if (rp instanceof RegExp) {
        this.testRegExp(e, rp, rest.rest(), absolute);
      }
    }
  }
  testRegExp(e, p, rest, absolute) {
    if (!p.test(e.name))
      return;
    if (!rest) {
      this.matches.add(e, absolute, false);
    } else {
      this.subwalks.add(e, rest);
    }
  }
  testString(e, p, rest, absolute) {
    if (!e.isNamed(p))
      return;
    if (!rest) {
      this.matches.add(e, absolute, false);
    } else {
      this.subwalks.add(e, rest);
    }
  }
};

// ../core/node_modules/glob/dist/mjs/walker.js
var makeIgnore = (ignore2, opts) => typeof ignore2 === "string" ? new Ignore([ignore2], opts) : Array.isArray(ignore2) ? new Ignore(ignore2, opts) : ignore2;
var GlobUtil = class {
  path;
  patterns;
  opts;
  seen = /* @__PURE__ */ new Set();
  paused = false;
  aborted = false;
  #onResume = [];
  #ignore;
  #sep;
  signal;
  maxDepth;
  constructor(patterns, path13, opts) {
    this.patterns = patterns;
    this.path = path13;
    this.opts = opts;
    this.#sep = !opts.posix && opts.platform === "win32" ? "\\" : "/";
    if (opts.ignore) {
      this.#ignore = makeIgnore(opts.ignore, opts);
    }
    this.maxDepth = opts.maxDepth || Infinity;
    if (opts.signal) {
      this.signal = opts.signal;
      this.signal.addEventListener("abort", () => {
        this.#onResume.length = 0;
      });
    }
  }
  #ignored(path13) {
    return this.seen.has(path13) || !!this.#ignore?.ignored?.(path13);
  }
  #childrenIgnored(path13) {
    return !!this.#ignore?.childrenIgnored?.(path13);
  }
  // backpressure mechanism
  pause() {
    this.paused = true;
  }
  resume() {
    if (this.signal?.aborted)
      return;
    this.paused = false;
    let fn = void 0;
    while (!this.paused && (fn = this.#onResume.shift())) {
      fn();
    }
  }
  onResume(fn) {
    if (this.signal?.aborted)
      return;
    if (!this.paused) {
      fn();
    } else {
      this.#onResume.push(fn);
    }
  }
  // do the requisite realpath/stat checking, and return the path
  // to add or undefined to filter it out.
  async matchCheck(e, ifDir) {
    if (ifDir && this.opts.nodir)
      return void 0;
    let rpc;
    if (this.opts.realpath) {
      rpc = e.realpathCached() || await e.realpath();
      if (!rpc)
        return void 0;
      e = rpc;
    }
    const needStat = e.isUnknown() || this.opts.stat;
    return this.matchCheckTest(needStat ? await e.lstat() : e, ifDir);
  }
  matchCheckTest(e, ifDir) {
    return e && (this.maxDepth === Infinity || e.depth() <= this.maxDepth) && (!ifDir || e.canReaddir()) && (!this.opts.nodir || !e.isDirectory()) && !this.#ignored(e) ? e : void 0;
  }
  matchCheckSync(e, ifDir) {
    if (ifDir && this.opts.nodir)
      return void 0;
    let rpc;
    if (this.opts.realpath) {
      rpc = e.realpathCached() || e.realpathSync();
      if (!rpc)
        return void 0;
      e = rpc;
    }
    const needStat = e.isUnknown() || this.opts.stat;
    return this.matchCheckTest(needStat ? e.lstatSync() : e, ifDir);
  }
  matchFinish(e, absolute) {
    if (this.#ignored(e))
      return;
    const abs = this.opts.absolute === void 0 ? absolute : this.opts.absolute;
    this.seen.add(e);
    const mark = this.opts.mark && e.isDirectory() ? this.#sep : "";
    if (this.opts.withFileTypes) {
      this.matchEmit(e);
    } else if (abs) {
      const abs2 = this.opts.posix ? e.fullpathPosix() : e.fullpath();
      this.matchEmit(abs2 + mark);
    } else {
      const rel = this.opts.posix ? e.relativePosix() : e.relative();
      const pre = this.opts.dotRelative && !rel.startsWith(".." + this.#sep) ? "." + this.#sep : "";
      this.matchEmit(!rel ? "." + mark : pre + rel + mark);
    }
  }
  async match(e, absolute, ifDir) {
    const p = await this.matchCheck(e, ifDir);
    if (p)
      this.matchFinish(p, absolute);
  }
  matchSync(e, absolute, ifDir) {
    const p = this.matchCheckSync(e, ifDir);
    if (p)
      this.matchFinish(p, absolute);
  }
  walkCB(target, patterns, cb) {
    if (this.signal?.aborted)
      cb();
    this.walkCB2(target, patterns, new Processor(this.opts), cb);
  }
  walkCB2(target, patterns, processor, cb) {
    if (this.#childrenIgnored(target))
      return cb();
    if (this.signal?.aborted)
      cb();
    if (this.paused) {
      this.onResume(() => this.walkCB2(target, patterns, processor, cb));
      return;
    }
    processor.processPatterns(target, patterns);
    let tasks = 1;
    const next = () => {
      if (--tasks === 0)
        cb();
    };
    for (const [m, absolute, ifDir] of processor.matches.entries()) {
      if (this.#ignored(m))
        continue;
      tasks++;
      this.match(m, absolute, ifDir).then(() => next());
    }
    for (const t of processor.subwalkTargets()) {
      if (this.maxDepth !== Infinity && t.depth() >= this.maxDepth) {
        continue;
      }
      tasks++;
      const childrenCached = t.readdirCached();
      if (t.calledReaddir())
        this.walkCB3(t, childrenCached, processor, next);
      else {
        t.readdirCB((_, entries) => this.walkCB3(t, entries, processor, next), true);
      }
    }
    next();
  }
  walkCB3(target, entries, processor, cb) {
    processor = processor.filterEntries(target, entries);
    let tasks = 1;
    const next = () => {
      if (--tasks === 0)
        cb();
    };
    for (const [m, absolute, ifDir] of processor.matches.entries()) {
      if (this.#ignored(m))
        continue;
      tasks++;
      this.match(m, absolute, ifDir).then(() => next());
    }
    for (const [target2, patterns] of processor.subwalks.entries()) {
      tasks++;
      this.walkCB2(target2, patterns, processor.child(), next);
    }
    next();
  }
  walkCBSync(target, patterns, cb) {
    if (this.signal?.aborted)
      cb();
    this.walkCB2Sync(target, patterns, new Processor(this.opts), cb);
  }
  walkCB2Sync(target, patterns, processor, cb) {
    if (this.#childrenIgnored(target))
      return cb();
    if (this.signal?.aborted)
      cb();
    if (this.paused) {
      this.onResume(() => this.walkCB2Sync(target, patterns, processor, cb));
      return;
    }
    processor.processPatterns(target, patterns);
    let tasks = 1;
    const next = () => {
      if (--tasks === 0)
        cb();
    };
    for (const [m, absolute, ifDir] of processor.matches.entries()) {
      if (this.#ignored(m))
        continue;
      this.matchSync(m, absolute, ifDir);
    }
    for (const t of processor.subwalkTargets()) {
      if (this.maxDepth !== Infinity && t.depth() >= this.maxDepth) {
        continue;
      }
      tasks++;
      const children = t.readdirSync();
      this.walkCB3Sync(t, children, processor, next);
    }
    next();
  }
  walkCB3Sync(target, entries, processor, cb) {
    processor = processor.filterEntries(target, entries);
    let tasks = 1;
    const next = () => {
      if (--tasks === 0)
        cb();
    };
    for (const [m, absolute, ifDir] of processor.matches.entries()) {
      if (this.#ignored(m))
        continue;
      this.matchSync(m, absolute, ifDir);
    }
    for (const [target2, patterns] of processor.subwalks.entries()) {
      tasks++;
      this.walkCB2Sync(target2, patterns, processor.child(), next);
    }
    next();
  }
};
var GlobWalker = class extends GlobUtil {
  matches;
  constructor(patterns, path13, opts) {
    super(patterns, path13, opts);
    this.matches = /* @__PURE__ */ new Set();
  }
  matchEmit(e) {
    this.matches.add(e);
  }
  async walk() {
    if (this.signal?.aborted)
      throw this.signal.reason;
    if (this.path.isUnknown()) {
      await this.path.lstat();
    }
    await new Promise((res, rej) => {
      this.walkCB(this.path, this.patterns, () => {
        if (this.signal?.aborted) {
          rej(this.signal.reason);
        } else {
          res(this.matches);
        }
      });
    });
    return this.matches;
  }
  walkSync() {
    if (this.signal?.aborted)
      throw this.signal.reason;
    if (this.path.isUnknown()) {
      this.path.lstatSync();
    }
    this.walkCBSync(this.path, this.patterns, () => {
      if (this.signal?.aborted)
        throw this.signal.reason;
    });
    return this.matches;
  }
};
var GlobStream = class extends GlobUtil {
  results;
  constructor(patterns, path13, opts) {
    super(patterns, path13, opts);
    this.results = new Minipass2({
      signal: this.signal,
      objectMode: true
    });
    this.results.on("drain", () => this.resume());
    this.results.on("resume", () => this.resume());
  }
  matchEmit(e) {
    this.results.write(e);
    if (!this.results.flowing)
      this.pause();
  }
  stream() {
    const target = this.path;
    if (target.isUnknown()) {
      target.lstat().then(() => {
        this.walkCB(target, this.patterns, () => this.results.end());
      });
    } else {
      this.walkCB(target, this.patterns, () => this.results.end());
    }
    return this.results;
  }
  streamSync() {
    if (this.path.isUnknown()) {
      this.path.lstatSync();
    }
    this.walkCBSync(this.path, this.patterns, () => this.results.end());
    return this.results;
  }
};

// ../core/node_modules/glob/dist/mjs/glob.js
var defaultPlatform3 = typeof process === "object" && process && typeof process.platform === "string" ? process.platform : "linux";
var Glob = class {
  absolute;
  cwd;
  root;
  dot;
  dotRelative;
  follow;
  ignore;
  magicalBraces;
  mark;
  matchBase;
  maxDepth;
  nobrace;
  nocase;
  nodir;
  noext;
  noglobstar;
  pattern;
  platform;
  realpath;
  scurry;
  stat;
  signal;
  windowsPathsNoEscape;
  withFileTypes;
  /**
   * The options provided to the constructor.
   */
  opts;
  /**
   * An array of parsed immutable {@link Pattern} objects.
   */
  patterns;
  /**
   * All options are stored as properties on the `Glob` object.
   *
   * See {@link GlobOptions} for full options descriptions.
   *
   * Note that a previous `Glob` object can be passed as the
   * `GlobOptions` to another `Glob` instantiation to re-use settings
   * and caches with a new pattern.
   *
   * Traversal functions can be called multiple times to run the walk
   * again.
   */
  constructor(pattern, opts) {
    this.withFileTypes = !!opts.withFileTypes;
    this.signal = opts.signal;
    this.follow = !!opts.follow;
    this.dot = !!opts.dot;
    this.dotRelative = !!opts.dotRelative;
    this.nodir = !!opts.nodir;
    this.mark = !!opts.mark;
    if (!opts.cwd) {
      this.cwd = "";
    } else if (opts.cwd instanceof URL || opts.cwd.startsWith("file://")) {
      opts.cwd = fileURLToPath2(opts.cwd);
    }
    this.cwd = opts.cwd || "";
    this.root = opts.root;
    this.magicalBraces = !!opts.magicalBraces;
    this.nobrace = !!opts.nobrace;
    this.noext = !!opts.noext;
    this.realpath = !!opts.realpath;
    this.absolute = opts.absolute;
    this.noglobstar = !!opts.noglobstar;
    this.matchBase = !!opts.matchBase;
    this.maxDepth = typeof opts.maxDepth === "number" ? opts.maxDepth : Infinity;
    this.stat = !!opts.stat;
    this.ignore = opts.ignore;
    if (this.withFileTypes && this.absolute !== void 0) {
      throw new Error("cannot set absolute and withFileTypes:true");
    }
    if (typeof pattern === "string") {
      pattern = [pattern];
    }
    this.windowsPathsNoEscape = !!opts.windowsPathsNoEscape || opts.allowWindowsEscape === false;
    if (this.windowsPathsNoEscape) {
      pattern = pattern.map((p) => p.replace(/\\/g, "/"));
    }
    if (this.matchBase) {
      if (opts.noglobstar) {
        throw new TypeError("base matching requires globstar");
      }
      pattern = pattern.map((p) => p.includes("/") ? p : `./**/${p}`);
    }
    this.pattern = pattern;
    this.platform = opts.platform || defaultPlatform3;
    this.opts = { ...opts, platform: this.platform };
    if (opts.scurry) {
      this.scurry = opts.scurry;
      if (opts.nocase !== void 0 && opts.nocase !== opts.scurry.nocase) {
        throw new Error("nocase option contradicts provided scurry option");
      }
    } else {
      const Scurry = opts.platform === "win32" ? PathScurryWin32 : opts.platform === "darwin" ? PathScurryDarwin : opts.platform ? PathScurryPosix : PathScurry;
      this.scurry = new Scurry(this.cwd, {
        nocase: opts.nocase,
        fs: opts.fs
      });
    }
    this.nocase = this.scurry.nocase;
    const nocaseMagicOnly = this.platform === "darwin" || this.platform === "win32";
    const mmo = {
      // default nocase based on platform
      ...opts,
      dot: this.dot,
      matchBase: this.matchBase,
      nobrace: this.nobrace,
      nocase: this.nocase,
      nocaseMagicOnly,
      nocomment: true,
      noext: this.noext,
      nonegate: true,
      optimizationLevel: 2,
      platform: this.platform,
      windowsPathsNoEscape: this.windowsPathsNoEscape,
      debug: !!this.opts.debug
    };
    const mms = this.pattern.map((p) => new Minimatch(p, mmo));
    const [matchSet, globParts] = mms.reduce((set, m) => {
      set[0].push(...m.set);
      set[1].push(...m.globParts);
      return set;
    }, [[], []]);
    this.patterns = matchSet.map((set, i) => {
      return new Pattern(set, globParts[i], 0, this.platform);
    });
  }
  async walk() {
    return [
      ...await new GlobWalker(this.patterns, this.scurry.cwd, {
        ...this.opts,
        maxDepth: this.maxDepth !== Infinity ? this.maxDepth + this.scurry.cwd.depth() : Infinity,
        platform: this.platform,
        nocase: this.nocase
      }).walk()
    ];
  }
  walkSync() {
    return [
      ...new GlobWalker(this.patterns, this.scurry.cwd, {
        ...this.opts,
        maxDepth: this.maxDepth !== Infinity ? this.maxDepth + this.scurry.cwd.depth() : Infinity,
        platform: this.platform,
        nocase: this.nocase
      }).walkSync()
    ];
  }
  stream() {
    return new GlobStream(this.patterns, this.scurry.cwd, {
      ...this.opts,
      maxDepth: this.maxDepth !== Infinity ? this.maxDepth + this.scurry.cwd.depth() : Infinity,
      platform: this.platform,
      nocase: this.nocase
    }).stream();
  }
  streamSync() {
    return new GlobStream(this.patterns, this.scurry.cwd, {
      ...this.opts,
      maxDepth: this.maxDepth !== Infinity ? this.maxDepth + this.scurry.cwd.depth() : Infinity,
      platform: this.platform,
      nocase: this.nocase
    }).streamSync();
  }
  /**
   * Default sync iteration function. Returns a Generator that
   * iterates over the results.
   */
  iterateSync() {
    return this.streamSync()[Symbol.iterator]();
  }
  [Symbol.iterator]() {
    return this.iterateSync();
  }
  /**
   * Default async iteration function. Returns an AsyncGenerator that
   * iterates over the results.
   */
  iterate() {
    return this.stream()[Symbol.asyncIterator]();
  }
  [Symbol.asyncIterator]() {
    return this.iterate();
  }
};

// ../core/node_modules/glob/dist/mjs/has-magic.js
var hasMagic = (pattern, options = {}) => {
  if (!Array.isArray(pattern)) {
    pattern = [pattern];
  }
  for (const p of pattern) {
    if (new Minimatch(p, options).hasMagic())
      return true;
  }
  return false;
};

// ../core/node_modules/glob/dist/mjs/index.js
function globStreamSync(pattern, options = {}) {
  return new Glob(pattern, options).streamSync();
}
function globStream(pattern, options = {}) {
  return new Glob(pattern, options).stream();
}
function globSync(pattern, options = {}) {
  return new Glob(pattern, options).walkSync();
}
async function glob_(pattern, options = {}) {
  return new Glob(pattern, options).walk();
}
function globIterateSync(pattern, options = {}) {
  return new Glob(pattern, options).iterateSync();
}
function globIterate(pattern, options = {}) {
  return new Glob(pattern, options).iterate();
}
var streamSync = globStreamSync;
var stream = Object.assign(globStream, { sync: globStreamSync });
var iterateSync = globIterateSync;
var iterate = Object.assign(globIterate, {
  sync: globIterateSync
});
var sync = Object.assign(globSync, {
  stream: globStreamSync,
  iterate: globIterateSync
});
var glob = Object.assign(glob_, {
  glob: glob_,
  globSync,
  sync,
  globStream,
  stream,
  globStreamSync,
  streamSync,
  globIterate,
  iterate,
  globIterateSync,
  iterateSync,
  Glob,
  hasMagic,
  escape,
  unescape
});
glob.glob = glob;

// ../core/dist/indexer/scanner.js
var import_ignore2 = __toESM(require_ignore(), 1);
import fs from "fs/promises";
import path2 from "path";
async function scanCodebaseWithFrameworks(rootDir, config) {
  const allFiles = [];
  for (const framework of config.frameworks) {
    if (!framework.enabled) {
      continue;
    }
    const frameworkFiles = await scanFramework(rootDir, framework);
    allFiles.push(...frameworkFiles);
  }
  return Array.from(new Set(allFiles));
}
async function scanFramework(rootDir, framework) {
  const frameworkPath = path2.join(rootDir, framework.path);
  const gitignorePath = path2.join(frameworkPath, ".gitignore");
  let ig = (0, import_ignore2.default)();
  try {
    const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
    ig = (0, import_ignore2.default)().add(gitignoreContent);
  } catch (e) {
    const rootGitignorePath = path2.join(rootDir, ".gitignore");
    try {
      const gitignoreContent = await fs.readFile(rootGitignorePath, "utf-8");
      ig = (0, import_ignore2.default)().add(gitignoreContent);
    } catch (e2) {
    }
  }
  ig.add([
    ...framework.config.exclude,
    ".lien/**"
  ]);
  const allFiles = [];
  for (const pattern of framework.config.include) {
    const files = await glob(pattern, {
      cwd: frameworkPath,
      absolute: false,
      // Get paths relative to framework path
      nodir: true,
      ignore: framework.config.exclude
    });
    allFiles.push(...files);
  }
  const uniqueFiles = Array.from(new Set(allFiles));
  return uniqueFiles.filter((file) => !ig.ignores(file)).map((file) => {
    return framework.path === "." ? file : path2.join(framework.path, file);
  });
}
async function scanCodebase(options) {
  const { rootDir, includePatterns = [], excludePatterns = [] } = options;
  const gitignorePath = path2.join(rootDir, ".gitignore");
  let ig = (0, import_ignore2.default)();
  try {
    const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
    ig = (0, import_ignore2.default)().add(gitignoreContent);
  } catch (e) {
  }
  ig.add([
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    "*.min.js",
    "*.min.css",
    ".lien/**",
    ...excludePatterns
  ]);
  const patterns = includePatterns.length > 0 ? includePatterns : ["**/*.{ts,tsx,js,jsx,py,php,go,rs,java,cpp,c,cs,h,md,mdx}"];
  const allFiles = [];
  for (const pattern of patterns) {
    const files = await glob(pattern, {
      cwd: rootDir,
      absolute: true,
      nodir: true,
      ignore: ["node_modules/**", ".git/**"]
    });
    allFiles.push(...files);
  }
  const uniqueFiles = Array.from(new Set(allFiles));
  return uniqueFiles.filter((file) => {
    const relativePath = path2.relative(rootDir, file);
    return !ig.ignores(relativePath);
  });
}
function detectLanguage(filepath) {
  const ext2 = path2.extname(filepath).toLowerCase();
  const languageMap = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".vue": "vue",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".c": "c",
    ".h": "c",
    ".hpp": "cpp",
    ".php": "php",
    ".rb": "ruby",
    ".swift": "swift",
    ".kt": "kotlin",
    ".cs": "csharp",
    ".scala": "scala",
    ".liquid": "liquid",
    ".md": "markdown",
    ".mdx": "markdown",
    ".markdown": "markdown"
  };
  return languageMap[ext2] || "unknown";
}

// ../core/dist/indexer/symbol-extractor.js
function extractSymbols(content, language) {
  const symbols = {
    functions: [],
    classes: [],
    interfaces: []
  };
  const normalizedLang = language.toLowerCase();
  switch (normalizedLang) {
    case "typescript":
    case "tsx":
      symbols.functions = extractTSFunctions(content);
      symbols.classes = extractTSClasses(content);
      symbols.interfaces = extractTSInterfaces(content);
      break;
    case "javascript":
    case "jsx":
      symbols.functions = extractJSFunctions(content);
      symbols.classes = extractJSClasses(content);
      break;
    case "python":
    case "py":
      symbols.functions = extractPythonFunctions(content);
      symbols.classes = extractPythonClasses(content);
      break;
    case "php":
      symbols.functions = extractPHPFunctions(content);
      symbols.classes = extractPHPClasses(content);
      symbols.interfaces = extractPHPInterfaces(content);
      break;
    case "vue":
      symbols.functions = extractVueFunctions(content);
      symbols.classes = extractVueComponents(content);
      break;
    case "go":
      symbols.functions = extractGoFunctions(content);
      symbols.interfaces = extractGoInterfaces(content);
      break;
    case "java":
      symbols.functions = extractJavaFunctions(content);
      symbols.classes = extractJavaClasses(content);
      symbols.interfaces = extractJavaInterfaces(content);
      break;
    case "csharp":
    case "cs":
      symbols.functions = extractCSharpFunctions(content);
      symbols.classes = extractCSharpClasses(content);
      symbols.interfaces = extractCSharpInterfaces(content);
      break;
    case "ruby":
    case "rb":
      symbols.functions = extractRubyFunctions(content);
      symbols.classes = extractRubyClasses(content);
      break;
    case "rust":
    case "rs":
      symbols.functions = extractRustFunctions(content);
      break;
  }
  return symbols;
}
function extractTSFunctions(content) {
  const names = /* @__PURE__ */ new Set();
  const functionMatches = content.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g);
  for (const match2 of functionMatches) {
    names.add(match2[1]);
  }
  const arrowMatches = content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g);
  for (const match2 of arrowMatches) {
    names.add(match2[1]);
  }
  const methodMatches = content.matchAll(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/g);
  for (const match2 of methodMatches) {
    if (!["if", "for", "while", "switch", "catch"].includes(match2[1])) {
      names.add(match2[1]);
    }
  }
  const exportMatches = content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g);
  for (const match2 of exportMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractJSFunctions(content) {
  return extractTSFunctions(content);
}
function extractTSClasses(content) {
  const names = /* @__PURE__ */ new Set();
  const classMatches = content.matchAll(/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g);
  for (const match2 of classMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractJSClasses(content) {
  return extractTSClasses(content);
}
function extractTSInterfaces(content) {
  const names = /* @__PURE__ */ new Set();
  const interfaceMatches = content.matchAll(/(?:export\s+)?interface\s+(\w+)/g);
  for (const match2 of interfaceMatches) {
    names.add(match2[1]);
  }
  const typeMatches = content.matchAll(/(?:export\s+)?type\s+(\w+)\s*=/g);
  for (const match2 of typeMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractPythonFunctions(content) {
  const names = /* @__PURE__ */ new Set();
  const functionMatches = content.matchAll(/def\s+(\w+)\s*\(/g);
  for (const match2 of functionMatches) {
    names.add(match2[1]);
  }
  const asyncMatches = content.matchAll(/async\s+def\s+(\w+)\s*\(/g);
  for (const match2 of asyncMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractPythonClasses(content) {
  const names = /* @__PURE__ */ new Set();
  const classMatches = content.matchAll(/class\s+(\w+)(?:\s*\(|:)/g);
  for (const match2 of classMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractPHPFunctions(content) {
  const names = /* @__PURE__ */ new Set();
  const functionMatches = content.matchAll(/(?:public|private|protected)?\s*function\s+(\w+)\s*\(/g);
  for (const match2 of functionMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractPHPClasses(content) {
  const names = /* @__PURE__ */ new Set();
  const classMatches = content.matchAll(/(?:abstract\s+)?class\s+(\w+)/g);
  for (const match2 of classMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractPHPInterfaces(content) {
  const names = /* @__PURE__ */ new Set();
  const interfaceMatches = content.matchAll(/interface\s+(\w+)/g);
  for (const match2 of interfaceMatches) {
    names.add(match2[1]);
  }
  const traitMatches = content.matchAll(/trait\s+(\w+)/g);
  for (const match2 of traitMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractGoFunctions(content) {
  const names = /* @__PURE__ */ new Set();
  const functionMatches = content.matchAll(/func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/g);
  for (const match2 of functionMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractGoInterfaces(content) {
  const names = /* @__PURE__ */ new Set();
  const interfaceMatches = content.matchAll(/type\s+(\w+)\s+interface\s*\{/g);
  for (const match2 of interfaceMatches) {
    names.add(match2[1]);
  }
  const structMatches = content.matchAll(/type\s+(\w+)\s+struct\s*\{/g);
  for (const match2 of structMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractJavaFunctions(content) {
  const names = /* @__PURE__ */ new Set();
  const methodMatches = content.matchAll(/(?:public|private|protected)\s+(?:static\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/g);
  for (const match2 of methodMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractJavaClasses(content) {
  const names = /* @__PURE__ */ new Set();
  const classMatches = content.matchAll(/(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/g);
  for (const match2 of classMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractJavaInterfaces(content) {
  const names = /* @__PURE__ */ new Set();
  const interfaceMatches = content.matchAll(/(?:public\s+)?interface\s+(\w+)/g);
  for (const match2 of interfaceMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractCSharpFunctions(content) {
  const names = /* @__PURE__ */ new Set();
  const methodMatches = content.matchAll(/(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/g);
  for (const match2 of methodMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractCSharpClasses(content) {
  const names = /* @__PURE__ */ new Set();
  const classMatches = content.matchAll(/(?:public|internal)?\s*(?:abstract\s+)?class\s+(\w+)/g);
  for (const match2 of classMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractCSharpInterfaces(content) {
  const names = /* @__PURE__ */ new Set();
  const interfaceMatches = content.matchAll(/(?:public|internal)?\s*interface\s+(\w+)/g);
  for (const match2 of interfaceMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractRubyFunctions(content) {
  const names = /* @__PURE__ */ new Set();
  const methodMatches = content.matchAll(/def\s+(?:self\.)?(\w+)/g);
  for (const match2 of methodMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractRubyClasses(content) {
  const names = /* @__PURE__ */ new Set();
  const classMatches = content.matchAll(/class\s+(\w+)/g);
  for (const match2 of classMatches) {
    names.add(match2[1]);
  }
  const moduleMatches = content.matchAll(/module\s+(\w+)/g);
  for (const match2 of moduleMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractRustFunctions(content) {
  const names = /* @__PURE__ */ new Set();
  const functionMatches = content.matchAll(/(?:pub\s+)?fn\s+(\w+)\s*\(/g);
  for (const match2 of functionMatches) {
    names.add(match2[1]);
  }
  const structMatches = content.matchAll(/(?:pub\s+)?struct\s+(\w+)/g);
  for (const match2 of structMatches) {
    names.add(match2[1]);
  }
  const traitMatches = content.matchAll(/(?:pub\s+)?trait\s+(\w+)/g);
  for (const match2 of traitMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractVueFunctions(content) {
  const names = /* @__PURE__ */ new Set();
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!scriptMatch)
    return [];
  const scriptContent = scriptMatch[1];
  const compositionMatches = scriptContent.matchAll(/(?:const|function)\s+(\w+)\s*=/g);
  for (const match2 of compositionMatches) {
    names.add(match2[1]);
  }
  const methodMatches = scriptContent.matchAll(/(\w+)\s*\([^)]*\)\s*{/g);
  for (const match2 of methodMatches) {
    names.add(match2[1]);
  }
  return Array.from(names);
}
function extractVueComponents(content) {
  const names = /* @__PURE__ */ new Set();
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!scriptMatch)
    return [];
  const scriptContent = scriptMatch[1];
  const nameMatch = scriptContent.match(/name:\s*['"](\w+)['"]/);
  if (nameMatch) {
    names.add(nameMatch[1]);
  }
  const defineComponentMatch = scriptContent.match(/defineComponent\s*\(/);
  if (defineComponentMatch) {
    names.add("VueComponent");
  }
  return Array.from(names);
}

// ../core/dist/indexer/ast/parser.js
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import JavaScript from "tree-sitter-javascript";
import PHPParser from "tree-sitter-php";
import Python from "tree-sitter-python";
import { extname } from "path";
var parserCache = /* @__PURE__ */ new Map();
var languageConfig = {
  typescript: TypeScript.typescript,
  javascript: JavaScript,
  php: PHPParser.php,
  // Note: tree-sitter-php exports both 'php' (mixed HTML/PHP) and 'php_only'
  python: Python
};
function getParser(language) {
  if (!parserCache.has(language)) {
    const parser = new Parser();
    const grammar = languageConfig[language];
    if (!grammar) {
      throw new Error(`No grammar available for language: ${language}`);
    }
    parser.setLanguage(grammar);
    parserCache.set(language, parser);
  }
  return parserCache.get(language);
}
function detectLanguage2(filePath) {
  const ext2 = extname(filePath).slice(1).toLowerCase();
  switch (ext2) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "php":
      return "php";
    case "py":
      return "python";
    default:
      return null;
  }
}
function isASTSupported(filePath) {
  return detectLanguage2(filePath) !== null;
}
function parseAST(content, language) {
  try {
    const parser = getParser(language);
    const tree = parser.parse(content);
    if (tree.rootNode.hasError) {
      return {
        tree,
        error: "Parse completed with errors"
      };
    }
    return { tree };
  } catch (error2) {
    return {
      tree: null,
      error: error2 instanceof Error ? error2.message : "Unknown parse error"
    };
  }
}

// ../core/dist/indexer/ast/complexity/cyclomatic.js
var DECISION_POINTS = [
  // Common across languages (TypeScript/JavaScript/Python/PHP)
  "if_statement",
  // if conditions
  "while_statement",
  // while loops
  "for_statement",
  // for loops
  "switch_case",
  // switch/case statements
  "catch_clause",
  // try/catch error handling
  "ternary_expression",
  // Ternary operator (a ? b : c)
  "binary_expression",
  // For && and || logical operators
  // TypeScript/JavaScript specific
  "do_statement",
  // do...while loops
  "for_in_statement",
  // for...in loops
  "for_of_statement",
  // for...of loops
  // PHP specific
  "foreach_statement",
  // PHP foreach loops
  // Python specific
  "elif_clause",
  // Python elif (adds decision point)
  // Note: 'else_clause' is NOT a decision point (it's the default path)
  "except_clause",
  // Python except (try/except)
  "conditional_expression"
  // Python ternary (x if cond else y)
];
function calculateComplexity(node) {
  let complexity = 1;
  function traverse(n) {
    if (DECISION_POINTS.includes(n.type)) {
      if (n.type === "binary_expression") {
        const operator = n.childForFieldName("operator");
        if (operator && (operator.text === "&&" || operator.text === "||")) {
          complexity++;
        }
      } else {
        complexity++;
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child)
        traverse(child);
    }
  }
  traverse(node);
  return complexity;
}

// ../core/dist/indexer/ast/complexity/cognitive.js
var NESTING_TYPES = /* @__PURE__ */ new Set([
  "if_statement",
  "for_statement",
  "while_statement",
  "switch_statement",
  "catch_clause",
  "except_clause",
  "do_statement",
  "for_in_statement",
  "for_of_statement",
  "foreach_statement",
  "match_statement"
]);
var NON_NESTING_TYPES = /* @__PURE__ */ new Set([
  "else_clause",
  "elif_clause",
  "ternary_expression",
  "conditional_expression"
]);
var LAMBDA_TYPES = /* @__PURE__ */ new Set(["arrow_function", "function_expression", "lambda"]);
function getLogicalOperator(node) {
  if (node.type !== "binary_expression" && node.type !== "boolean_operator") {
    return null;
  }
  const operator = node.childForFieldName("operator");
  const opText = operator?.text;
  if (opText === "&&" || opText === "and")
    return "&&";
  if (opText === "||" || opText === "or")
    return "||";
  return null;
}
function getChildNestingLevel(parent, child, currentLevel) {
  const isCondition = parent.childForFieldName("condition") === child;
  const isElseClause = NON_NESTING_TYPES.has(child.type);
  return !isCondition && !isElseClause ? currentLevel + 1 : currentLevel;
}
function getNestedLambdaIncrement(nodeType, nestingLevel) {
  return LAMBDA_TYPES.has(nodeType) && nestingLevel > 0 ? 1 : 0;
}
function traverseLogicalChildren(n, level, op, ctx) {
  const operator = n.childForFieldName("operator");
  for (let i = 0; i < n.namedChildCount; i++) {
    const child = n.namedChild(i);
    if (child && child !== operator)
      ctx.traverse(child, level, op);
  }
}
function traverseNestingChildren(n, level, ctx) {
  for (let i = 0; i < n.namedChildCount; i++) {
    const child = n.namedChild(i);
    if (child)
      ctx.traverse(child, getChildNestingLevel(n, child, level), null);
  }
}
function traverseAllChildren(n, level, ctx) {
  for (let i = 0; i < n.namedChildCount; i++) {
    const child = n.namedChild(i);
    if (child)
      ctx.traverse(child, level, null);
  }
}
function calculateCognitiveComplexity(node) {
  let complexity = 0;
  const ctx = { traverse };
  function traverse(n, nestingLevel, lastLogicalOp) {
    const logicalOp = getLogicalOperator(n);
    if (logicalOp) {
      complexity += lastLogicalOp !== logicalOp ? 1 : 0;
      traverseLogicalChildren(n, nestingLevel, logicalOp, ctx);
      return;
    }
    if (NESTING_TYPES.has(n.type)) {
      complexity += 1 + nestingLevel;
      traverseNestingChildren(n, nestingLevel, ctx);
      return;
    }
    if (NON_NESTING_TYPES.has(n.type)) {
      complexity += 1;
      traverseAllChildren(n, nestingLevel + 1, ctx);
      return;
    }
    complexity += getNestedLambdaIncrement(n.type, nestingLevel);
    traverseAllChildren(n, nestingLevel, ctx);
  }
  traverse(node, 0, null);
  return complexity;
}

// ../core/dist/indexer/ast/complexity/halstead.js
var OPERATOR_SYMBOLS = {
  typescript: /* @__PURE__ */ new Set([
    // Arithmetic
    "+",
    "-",
    "*",
    "/",
    "%",
    "**",
    // Comparison
    "==",
    "===",
    "!=",
    "!==",
    "<",
    ">",
    "<=",
    ">=",
    // Logical
    "&&",
    "||",
    "!",
    "??",
    // Assignment
    "=",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "**=",
    "&&=",
    "||=",
    "??=",
    // Bitwise
    "&",
    "|",
    "^",
    "~",
    "<<",
    ">>",
    ">>>",
    "&=",
    "|=",
    "^=",
    "<<=",
    ">>=",
    ">>>=",
    // Other
    "?",
    ":",
    ".",
    "?.",
    "++",
    "--",
    "...",
    "=>",
    // Brackets/parens (counted as operators)
    "(",
    ")",
    "[",
    "]",
    "{",
    "}"
  ]),
  python: /* @__PURE__ */ new Set([
    // Arithmetic
    "+",
    "-",
    "*",
    "/",
    "%",
    "**",
    "//",
    // Comparison
    "==",
    "!=",
    "<",
    ">",
    "<=",
    ">=",
    // Logical (handled via keywords below)
    // Assignment
    "=",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "**=",
    "//=",
    "&=",
    "|=",
    "^=",
    "<<=",
    ">>=",
    // Bitwise
    "&",
    "|",
    "^",
    "~",
    "<<",
    ">>",
    // Other
    ".",
    ":",
    "->",
    "@",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}"
  ]),
  php: /* @__PURE__ */ new Set([
    // Arithmetic
    "+",
    "-",
    "*",
    "/",
    "%",
    "**",
    // Comparison
    "==",
    "===",
    "!=",
    "!==",
    "<>",
    "<",
    ">",
    "<=",
    ">=",
    "<=>",
    // Logical
    "&&",
    "||",
    "!",
    "and",
    "or",
    "xor",
    // Assignment
    "=",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "**=",
    ".=",
    "&=",
    "|=",
    "^=",
    "<<=",
    ">>=",
    "??=",
    // Bitwise
    "&",
    "|",
    "^",
    "~",
    "<<",
    ">>",
    // String
    ".",
    // Other
    "?",
    ":",
    "::",
    "->",
    "=>",
    "??",
    "@",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}"
  ])
};
var OPERATOR_KEYWORDS = {
  typescript: /* @__PURE__ */ new Set([
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "default",
    "return",
    "throw",
    "try",
    "catch",
    "finally",
    "new",
    "delete",
    "typeof",
    "instanceof",
    "in",
    "of",
    "await",
    "yield",
    "break",
    "continue",
    "const",
    "let",
    "var",
    "function",
    "class",
    "extends",
    "implements",
    "import",
    "export",
    "from",
    "as"
  ]),
  python: /* @__PURE__ */ new Set([
    "if",
    "elif",
    "else",
    "for",
    "while",
    "match",
    "case",
    "return",
    "raise",
    "try",
    "except",
    "finally",
    "and",
    "or",
    "not",
    "is",
    "in",
    "await",
    "yield",
    "break",
    "continue",
    "pass",
    "def",
    "class",
    "lambda",
    "async",
    "import",
    "from",
    "as",
    "with",
    "global",
    "nonlocal",
    "del",
    "assert"
  ]),
  php: /* @__PURE__ */ new Set([
    "if",
    "elseif",
    "else",
    "for",
    "foreach",
    "while",
    "do",
    "switch",
    "case",
    "default",
    "match",
    "return",
    "throw",
    "try",
    "catch",
    "finally",
    "new",
    "clone",
    "instanceof",
    "yield",
    "break",
    "continue",
    "function",
    "class",
    "extends",
    "implements",
    "trait",
    "interface",
    "use",
    "namespace",
    "as",
    "echo",
    "print",
    "include",
    "require",
    "include_once",
    "require_once",
    "global",
    "static",
    "const",
    "public",
    "private",
    "protected",
    "readonly"
  ])
};
var OPERATOR_NODE_TYPES = /* @__PURE__ */ new Set([
  // Expression operators
  "binary_expression",
  "unary_expression",
  "update_expression",
  "assignment_expression",
  "augmented_assignment_expression",
  "ternary_expression",
  "conditional_expression",
  // Call/access operators
  "call_expression",
  "method_call",
  "member_expression",
  "subscript_expression",
  "attribute",
  // Object/array literals ([] and {} are operators)
  "array",
  "object",
  "dictionary",
  "list"
]);
var OPERAND_NODE_TYPES = /* @__PURE__ */ new Set([
  // Identifiers
  "identifier",
  "property_identifier",
  "shorthand_property_identifier",
  "variable_name",
  "name",
  // Literals
  "number",
  "integer",
  "float",
  "string",
  "string_fragment",
  "template_string",
  "true",
  "false",
  "null",
  "undefined",
  "none",
  // Special
  "this",
  "self",
  "super"
]);
function getOperatorSymbols(language) {
  return OPERATOR_SYMBOLS[language] || OPERATOR_SYMBOLS.typescript;
}
function getOperatorKeywords(language) {
  return OPERATOR_KEYWORDS[language] || OPERATOR_KEYWORDS.typescript;
}
function isOperator(node, language) {
  const nodeType = node.type;
  const nodeText = node.text;
  if (OPERATOR_NODE_TYPES.has(nodeType)) {
    return true;
  }
  const symbols = getOperatorSymbols(language);
  const keywords = getOperatorKeywords(language);
  return symbols.has(nodeText) || keywords.has(nodeText);
}
function isOperand(node) {
  return OPERAND_NODE_TYPES.has(node.type);
}
function getOperatorKey(node) {
  if (OPERATOR_NODE_TYPES.has(node.type)) {
    const operator = node.childForFieldName("operator");
    if (operator) {
      return operator.text;
    }
    return node.type;
  }
  return node.text;
}
function getOperandKey(node) {
  return node.text;
}
function sumValues(map) {
  let sum = 0;
  for (const count of map.values()) {
    sum += count;
  }
  return sum;
}
function countHalstead(node, language) {
  const operators = /* @__PURE__ */ new Map();
  const operands = /* @__PURE__ */ new Map();
  function traverse(n) {
    if (isOperator(n, language)) {
      const key = getOperatorKey(n);
      operators.set(key, (operators.get(key) || 0) + 1);
    }
    if (isOperand(n)) {
      const key = getOperandKey(n);
      operands.set(key, (operands.get(key) || 0) + 1);
    }
    for (const child of n.children) {
      traverse(child);
    }
  }
  traverse(node);
  return {
    n1: operators.size,
    n2: operands.size,
    N1: sumValues(operators),
    N2: sumValues(operands),
    operators,
    operands
  };
}
function calculateHalsteadMetrics(counts) {
  const { n1, n2, N1, N2 } = counts;
  const vocabulary = n1 + n2;
  const length = N1 + N2;
  const volume = vocabulary > 0 ? length * Math.log2(vocabulary) : 0;
  const difficulty = n2 > 0 ? n1 / 2 * (N2 / n2) : 0;
  const effort = difficulty * volume;
  const time = effort / 18;
  const bugs = volume / 3e3;
  return {
    vocabulary: Math.round(vocabulary),
    length: Math.round(length),
    volume: Math.round(volume * 100) / 100,
    difficulty: Math.round(difficulty * 100) / 100,
    effort: Math.round(effort),
    time: Math.round(time),
    bugs: Math.round(bugs * 1e3) / 1e3
  };
}
function calculateHalstead(node, language) {
  const counts = countHalstead(node, language);
  return calculateHalsteadMetrics(counts);
}

// ../core/dist/indexer/ast/symbols.js
function extractFunctionInfo(node, content, parentClass) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode)
    return null;
  return {
    name: nameNode.text,
    type: parentClass ? "method" : "function",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    parentClass,
    signature: extractSignature(node, content),
    parameters: extractParameters(node, content),
    returnType: extractReturnType(node, content),
    complexity: calculateComplexity(node)
  };
}
function extractArrowFunctionInfo(node, content, parentClass) {
  const parent = node.parent;
  let name = "anonymous";
  if (parent?.type === "variable_declarator") {
    const nameNode = parent.childForFieldName("name");
    name = nameNode?.text || "anonymous";
  }
  return {
    name,
    type: parentClass ? "method" : "function",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    parentClass,
    signature: extractSignature(node, content),
    parameters: extractParameters(node, content),
    complexity: calculateComplexity(node)
  };
}
function extractMethodInfo(node, content, parentClass) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode)
    return null;
  return {
    name: nameNode.text,
    type: "method",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    parentClass,
    signature: extractSignature(node, content),
    parameters: extractParameters(node, content),
    returnType: extractReturnType(node, content),
    complexity: calculateComplexity(node)
  };
}
function extractClassInfo(node, _content, _parentClass) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode)
    return null;
  return {
    name: nameNode.text,
    type: "class",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: `class ${nameNode.text}`
  };
}
function extractInterfaceInfo(node, _content, _parentClass) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode)
    return null;
  return {
    name: nameNode.text,
    type: "interface",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: `interface ${nameNode.text}`
  };
}
function extractPythonFunctionInfo(node, content, parentClass) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode)
    return null;
  return {
    name: nameNode.text,
    type: parentClass ? "method" : "function",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    parentClass,
    signature: extractSignature(node, content),
    parameters: extractParameters(node, content),
    complexity: calculateComplexity(node)
  };
}
function extractPythonClassInfo(node, _content, _parentClass) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode)
    return null;
  return {
    name: nameNode.text,
    type: "class",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: `class ${nameNode.text}`
  };
}
var symbolExtractors = {
  // TypeScript/JavaScript
  "function_declaration": extractFunctionInfo,
  "function": extractFunctionInfo,
  "arrow_function": extractArrowFunctionInfo,
  "function_expression": extractArrowFunctionInfo,
  "method_definition": extractMethodInfo,
  "class_declaration": extractClassInfo,
  "interface_declaration": extractInterfaceInfo,
  // PHP
  "function_definition": extractFunctionInfo,
  // PHP functions (Python handled via language check in extractSymbolInfo)
  "method_declaration": extractMethodInfo,
  // PHP methods
  // Python
  "async_function_definition": extractPythonFunctionInfo,
  // Python async functions
  "class_definition": extractPythonClassInfo
  // Python classes
  // Note: Python regular functions use 'function_definition' (same as PHP)
  // They are dispatched to extractPythonFunctionInfo via language check in extractSymbolInfo()
};
function extractSymbolInfo(node, content, parentClass, language) {
  if (node.type === "function_definition" && language === "python") {
    return extractPythonFunctionInfo(node, content, parentClass);
  }
  const extractor = symbolExtractors[node.type];
  return extractor ? extractor(node, content, parentClass) : null;
}
function extractSignature(node, content) {
  const startLine = node.startPosition.row;
  const lines = content.split("\n");
  let signature = lines[startLine] || "";
  let currentLine = startLine;
  while (currentLine < node.endPosition.row && !signature.includes("{") && !signature.includes("=>")) {
    currentLine++;
    signature += " " + (lines[currentLine] || "");
  }
  signature = signature.split("{")[0].split("=>")[0].trim();
  if (signature.length > 200) {
    signature = signature.substring(0, 197) + "...";
  }
  return signature;
}
function extractParameters(node, _content) {
  const parameters = [];
  const paramsNode = node.childForFieldName("parameters");
  if (!paramsNode)
    return parameters;
  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = paramsNode.namedChild(i);
    if (param) {
      parameters.push(param.text);
    }
  }
  return parameters;
}
function extractReturnType(node, _content) {
  const returnTypeNode = node.childForFieldName("return_type");
  if (!returnTypeNode)
    return void 0;
  return returnTypeNode.text;
}
function extractImports(rootNode) {
  const imports = [];
  function traverse(node) {
    if (node.type === "import_statement") {
      const sourceNode = node.childForFieldName("source");
      if (sourceNode) {
        const importPath = sourceNode.text.replace(/['"]/g, "");
        imports.push(importPath);
      } else {
        const importText = node.text.split("\n")[0];
        imports.push(importText);
      }
    } else if (node.type === "import_from_statement") {
      const importText = node.text.split("\n")[0];
      imports.push(importText);
    }
    if (node === rootNode) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child)
          traverse(child);
      }
    }
  }
  traverse(rootNode);
  return imports;
}

// ../core/dist/indexer/ast/traversers/typescript.js
var TypeScriptTraverser = class {
  targetNodeTypes = [
    "function_declaration",
    "function",
    "interface_declaration",
    "method_definition",
    "lexical_declaration",
    // For const/let with arrow functions
    "variable_declaration"
    // For var with functions
  ];
  containerTypes = [
    "class_declaration"
    // We extract methods, not the class itself
  ];
  declarationTypes = [
    "lexical_declaration",
    // const/let
    "variable_declaration"
    // var
  ];
  functionTypes = [
    "arrow_function",
    "function_expression",
    "function"
  ];
  shouldExtractChildren(node) {
    return this.containerTypes.includes(node.type);
  }
  isDeclarationWithFunction(node) {
    return this.declarationTypes.includes(node.type);
  }
  getContainerBody(node) {
    if (node.type === "class_declaration") {
      return node.childForFieldName("body");
    }
    return null;
  }
  shouldTraverseChildren(node) {
    return node.type === "program" || node.type === "export_statement" || node.type === "class_body";
  }
  findParentContainerName(node) {
    let current = node.parent;
    while (current) {
      if (current.type === "class_declaration") {
        const nameNode = current.childForFieldName("name");
        return nameNode?.text;
      }
      current = current.parent;
    }
    return void 0;
  }
  /**
   * Check if a declaration node contains a function (arrow, function expression, etc.)
   */
  findFunctionInDeclaration(node) {
    const search2 = (n, depth) => {
      if (depth > 3)
        return null;
      if (this.functionTypes.includes(n.type)) {
        return n;
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) {
          const result = search2(child, depth + 1);
          if (result)
            return result;
        }
      }
      return null;
    };
    const functionNode = search2(node, 0);
    return {
      hasFunction: functionNode !== null,
      functionNode
    };
  }
};
var JavaScriptTraverser = class extends TypeScriptTraverser {
};

// ../core/dist/indexer/ast/traversers/php.js
var PHPTraverser = class {
  targetNodeTypes = [
    "function_definition",
    // function foo() {}
    "method_declaration"
    // public function bar() {}
  ];
  containerTypes = [
    "class_declaration",
    // We extract methods, not the class itself
    "trait_declaration",
    // PHP traits
    "interface_declaration"
    // PHP interfaces (for interface methods)
  ];
  declarationTypes = [
    // PHP doesn't have arrow functions or const/let like JS
    // Functions are always defined with 'function' keyword
  ];
  functionTypes = [
    "function_definition",
    "method_declaration"
  ];
  shouldExtractChildren(node) {
    return this.containerTypes.includes(node.type);
  }
  isDeclarationWithFunction(_node) {
    return false;
  }
  getContainerBody(node) {
    if (node.type === "class_declaration" || node.type === "trait_declaration" || node.type === "interface_declaration") {
      return node.childForFieldName("body");
    }
    return null;
  }
  shouldTraverseChildren(node) {
    return node.type === "program" || // Top-level PHP file
    node.type === "php" || // PHP block
    node.type === "declaration_list";
  }
  findParentContainerName(node) {
    let current = node.parent;
    while (current) {
      if (current.type === "class_declaration" || current.type === "trait_declaration") {
        const nameNode = current.childForFieldName("name");
        return nameNode?.text;
      }
      current = current.parent;
    }
    return void 0;
  }
  findFunctionInDeclaration(_node) {
    return {
      hasFunction: false,
      functionNode: null
    };
  }
};

// ../core/dist/indexer/ast/traversers/python.js
var PythonTraverser = class {
  targetNodeTypes = [
    "function_definition",
    "async_function_definition"
  ];
  containerTypes = [
    "class_definition"
    // We extract methods, not the class itself
  ];
  declarationTypes = [
    // Python doesn't have const/let/var declarations like JS/TS
    // Functions are always defined with 'def' or 'async def'
  ];
  functionTypes = [
    "function_definition",
    "async_function_definition"
  ];
  shouldExtractChildren(node) {
    return this.containerTypes.includes(node.type);
  }
  isDeclarationWithFunction(_node) {
    return false;
  }
  getContainerBody(node) {
    if (node.type === "class_definition") {
      return node.childForFieldName("body");
    }
    return null;
  }
  shouldTraverseChildren(node) {
    return node.type === "module" || // Top-level Python file
    node.type === "block";
  }
  findParentContainerName(node) {
    let current = node.parent;
    while (current) {
      if (current.type === "class_definition") {
        const nameNode = current.childForFieldName("name");
        return nameNode?.text;
      }
      current = current.parent;
    }
    return void 0;
  }
  /**
   * Python doesn't have this pattern (const x = () => {})
   * Functions are always defined with 'def' or 'async def'
   */
  findFunctionInDeclaration(_node) {
    return {
      hasFunction: false,
      functionNode: null
    };
  }
};

// ../core/dist/indexer/ast/traversers/index.js
var traverserRegistry = {
  typescript: new TypeScriptTraverser(),
  javascript: new JavaScriptTraverser(),
  php: new PHPTraverser(),
  python: new PythonTraverser()
};
function getTraverser(language) {
  const traverser = traverserRegistry[language];
  if (!traverser) {
    throw new Error(`No traverser available for language: ${language}`);
  }
  return traverser;
}

// ../core/dist/indexer/ast/chunker.js
function chunkByAST(filepath, content, options = {}) {
  const { minChunkSize = 5 } = options;
  const language = detectLanguage2(filepath);
  if (!language) {
    throw new Error(`Unsupported language for file: ${filepath}`);
  }
  const parseResult = parseAST(content, language);
  if (!parseResult.tree) {
    throw new Error(`Failed to parse ${filepath}: ${parseResult.error}`);
  }
  const chunks = [];
  const lines = content.split("\n");
  const rootNode = parseResult.tree.rootNode;
  const traverser = getTraverser(language);
  const fileImports = extractImports(rootNode);
  const topLevelNodes = findTopLevelNodes(rootNode, traverser);
  for (const node of topLevelNodes) {
    let actualNode = node;
    if (traverser.isDeclarationWithFunction(node)) {
      const declInfo = traverser.findFunctionInDeclaration(node);
      if (declInfo.functionNode) {
        actualNode = declInfo.functionNode;
      }
    }
    const parentClassName = traverser.findParentContainerName(actualNode);
    const symbolInfo = extractSymbolInfo(actualNode, content, parentClassName, language);
    const nodeContent = getNodeContent(node, lines);
    chunks.push(createChunk(filepath, node, nodeContent, symbolInfo, fileImports, language));
  }
  const coveredRanges = topLevelNodes.map((n) => ({
    start: n.startPosition.row,
    end: n.endPosition.row
  }));
  const uncoveredChunks = extractUncoveredCode(lines, coveredRanges, filepath, minChunkSize, fileImports, language);
  chunks.push(...uncoveredChunks);
  chunks.sort((a, b) => a.metadata.startLine - b.metadata.startLine);
  return chunks;
}
function isFunctionDeclaration(node, depth, traverser) {
  if (depth !== 0 || !traverser.isDeclarationWithFunction(node))
    return false;
  return traverser.findFunctionInDeclaration(node).hasFunction;
}
function isTargetNode(node, depth, traverser) {
  return depth <= 1 && traverser.targetNodeTypes.includes(node.type);
}
function findTopLevelNodes(rootNode, traverser) {
  const nodes = [];
  function traverse(node, depth) {
    if (isFunctionDeclaration(node, depth, traverser) || isTargetNode(node, depth, traverser)) {
      nodes.push(node);
      return;
    }
    if (traverser.shouldExtractChildren(node)) {
      const body = traverser.getContainerBody(node);
      if (body)
        traverse(body, depth + 1);
      return;
    }
    if (!traverser.shouldTraverseChildren(node))
      return;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child)
        traverse(child, depth);
    }
  }
  traverse(rootNode, 0);
  return nodes;
}
function getNodeContent(node, lines) {
  const startLine = node.startPosition.row;
  const endLine = node.endPosition.row;
  return lines.slice(startLine, endLine + 1).join("\n");
}
var SYMBOL_TYPE_TO_ARRAY = {
  function: "functions",
  method: "functions",
  class: "classes",
  interface: "interfaces"
};
var COMPLEXITY_SYMBOL_TYPES = /* @__PURE__ */ new Set(["function", "method"]);
function buildLegacySymbols(symbolInfo) {
  const symbols = { functions: [], classes: [], interfaces: [] };
  if (symbolInfo?.name && symbolInfo.type) {
    const arrayKey = SYMBOL_TYPE_TO_ARRAY[symbolInfo.type];
    if (arrayKey)
      symbols[arrayKey].push(symbolInfo.name);
  }
  return symbols;
}
function getChunkType(symbolInfo) {
  if (!symbolInfo)
    return "block";
  return symbolInfo.type === "class" ? "class" : "function";
}
function createChunk(filepath, node, content, symbolInfo, imports, language) {
  const symbols = buildLegacySymbols(symbolInfo);
  const shouldCalcComplexity = symbolInfo?.type && COMPLEXITY_SYMBOL_TYPES.has(symbolInfo.type);
  const cognitiveComplexity = shouldCalcComplexity ? calculateCognitiveComplexity(node) : void 0;
  const halstead = shouldCalcComplexity ? calculateHalstead(node, language) : void 0;
  return {
    content,
    metadata: {
      file: filepath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      type: getChunkType(symbolInfo),
      language,
      symbols,
      symbolName: symbolInfo?.name,
      symbolType: symbolInfo?.type,
      parentClass: symbolInfo?.parentClass,
      complexity: symbolInfo?.complexity,
      cognitiveComplexity,
      parameters: symbolInfo?.parameters,
      signature: symbolInfo?.signature,
      imports,
      // Halstead metrics
      halsteadVolume: halstead?.volume,
      halsteadDifficulty: halstead?.difficulty,
      halsteadEffort: halstead?.effort,
      halsteadBugs: halstead?.bugs
    }
  };
}
function findUncoveredRanges(coveredRanges, totalLines) {
  const uncoveredRanges = [];
  let currentStart = 0;
  const sortedRanges = [...coveredRanges].sort((a, b) => a.start - b.start);
  for (const range of sortedRanges) {
    if (currentStart < range.start) {
      uncoveredRanges.push({
        start: currentStart,
        end: range.start - 1
      });
    }
    currentStart = range.end + 1;
  }
  if (currentStart < totalLines) {
    uncoveredRanges.push({
      start: currentStart,
      end: totalLines - 1
    });
  }
  return uncoveredRanges;
}
function createChunkFromRange(range, lines, filepath, language, imports) {
  const uncoveredLines = lines.slice(range.start, range.end + 1);
  const content = uncoveredLines.join("\n").trim();
  return {
    content,
    metadata: {
      file: filepath,
      startLine: range.start + 1,
      endLine: range.end + 1,
      type: "block",
      language,
      // Empty symbols for uncovered code (imports, exports, etc.)
      symbols: { functions: [], classes: [], interfaces: [] },
      imports
    }
  };
}
function isValidChunk(chunk, minChunkSize) {
  const lineCount = chunk.metadata.endLine - chunk.metadata.startLine + 1;
  return chunk.content.length > 0 && lineCount >= minChunkSize;
}
function extractUncoveredCode(lines, coveredRanges, filepath, minChunkSize, imports, language) {
  const uncoveredRanges = findUncoveredRanges(coveredRanges, lines.length);
  return uncoveredRanges.map((range) => createChunkFromRange(range, lines, filepath, language, imports)).filter((chunk) => isValidChunk(chunk, minChunkSize));
}
function shouldUseAST(filepath) {
  return isASTSupported(filepath);
}

// ../core/dist/indexer/liquid-chunker.js
function extractSchemaName(schemaContent) {
  try {
    let jsonContent = schemaContent.replace(/\{%-?\s*schema\s*-?%\}/g, "").replace(/\{%-?\s*endschema\s*-?%\}/g, "").trim();
    const schema = JSON.parse(jsonContent);
    return typeof schema.name === "string" ? schema.name : void 0;
  } catch (error2) {
  }
  return void 0;
}
function removeComments(content) {
  return content.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, "");
}
function extractRenderTags(contentWithoutComments) {
  const dependencies = /* @__PURE__ */ new Set();
  const renderPattern = /\{%-?\s*render\s+['"]([^'"]+)['"]/g;
  let match2;
  while ((match2 = renderPattern.exec(contentWithoutComments)) !== null) {
    dependencies.add(match2[1]);
  }
  const includePattern = /\{%-?\s*include\s+['"]([^'"]+)['"]/g;
  while ((match2 = includePattern.exec(contentWithoutComments)) !== null) {
    dependencies.add(match2[1]);
  }
  const sectionPattern = /\{%-?\s*section\s+['"]([^'"]+)['"]/g;
  while ((match2 = sectionPattern.exec(contentWithoutComments)) !== null) {
    dependencies.add(match2[1]);
  }
  return Array.from(dependencies);
}
function findLiquidBlocks(content) {
  const lines = content.split("\n");
  const blocks = [];
  const blockPatterns = [
    { type: "schema", start: /\{%-?\s*schema\s*-?%\}/, end: /\{%-?\s*endschema\s*-?%\}/ },
    { type: "style", start: /\{%-?\s*style\s*-?%\}/, end: /\{%-?\s*endstyle\s*-?%\}/ },
    { type: "javascript", start: /\{%-?\s*javascript\s*-?%\}/, end: /\{%-?\s*endjavascript\s*-?%\}/ }
  ];
  for (const pattern of blockPatterns) {
    let searchStart = 0;
    while (searchStart < lines.length) {
      const startIdx = lines.findIndex((line, idx) => idx >= searchStart && pattern.start.test(line));
      if (startIdx === -1)
        break;
      const endIdx = lines.findIndex((line, idx) => idx >= startIdx && pattern.end.test(line));
      if (endIdx === -1) {
        break;
      }
      const blockContent = lines.slice(startIdx, endIdx + 1).join("\n");
      blocks.push({
        type: pattern.type,
        startLine: startIdx,
        endLine: endIdx,
        content: blockContent
      });
      searchStart = endIdx + 1;
    }
  }
  return blocks.sort((a, b) => a.startLine - b.startLine);
}
function createCodeChunk(content, startLine, endLine, filepath, type, options = {}) {
  return {
    content,
    metadata: {
      file: filepath,
      startLine,
      endLine,
      language: "liquid",
      type,
      symbolName: options.symbolName,
      symbolType: options.symbolType,
      imports: options.imports?.length ? options.imports : void 0
    }
  };
}
function splitLargeBlock(block, ctx, symbolName, imports) {
  const chunks = [];
  const blockLines = block.content.split("\n");
  const { chunkSize, chunkOverlap, filepath } = ctx.params;
  for (let offset = 0; offset < blockLines.length; offset += chunkSize - chunkOverlap) {
    const endOffset = Math.min(offset + chunkSize, blockLines.length);
    const chunkContent = blockLines.slice(offset, endOffset).join("\n");
    if (chunkContent.trim().length > 0) {
      chunks.push(createCodeChunk(chunkContent, block.startLine + offset + 1, block.startLine + endOffset, filepath, "block", { symbolName, symbolType: block.type, imports }));
    }
    if (endOffset >= blockLines.length)
      break;
  }
  return chunks;
}
function processSpecialBlock(block, ctx, coveredLines) {
  for (let i = block.startLine; i <= block.endLine; i++) {
    coveredLines.add(i);
  }
  const symbolName = block.type === "schema" ? extractSchemaName(block.content) : void 0;
  const blockContentWithoutComments = ctx.linesWithoutComments.slice(block.startLine, block.endLine + 1).join("\n");
  const imports = extractRenderTags(blockContentWithoutComments);
  const blockLineCount = block.endLine - block.startLine + 1;
  const maxBlockSize = ctx.params.chunkSize * 3;
  if (blockLineCount <= maxBlockSize) {
    return [createCodeChunk(block.content, block.startLine + 1, block.endLine + 1, ctx.params.filepath, "block", { symbolName, symbolType: block.type, imports })];
  }
  return splitLargeBlock(block, ctx, symbolName, imports);
}
function flushTemplateChunk(currentChunk, chunkStartLine, endLine, ctx) {
  if (currentChunk.length === 0)
    return null;
  const chunkContent = currentChunk.join("\n");
  if (chunkContent.trim().length === 0)
    return null;
  const cleanedChunk = ctx.linesWithoutComments.slice(chunkStartLine, endLine).join("\n");
  const imports = extractRenderTags(cleanedChunk);
  return createCodeChunk(chunkContent, chunkStartLine + 1, endLine, ctx.params.filepath, "template", { imports });
}
function processTemplateContent(ctx, coveredLines) {
  const chunks = [];
  const { lines, params } = ctx;
  const { chunkSize, chunkOverlap } = params;
  let currentChunk = [];
  let chunkStartLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (coveredLines.has(i)) {
      const chunk = flushTemplateChunk(currentChunk, chunkStartLine, i, ctx);
      if (chunk)
        chunks.push(chunk);
      currentChunk = [];
      continue;
    }
    if (currentChunk.length === 0) {
      chunkStartLine = i;
    }
    currentChunk.push(lines[i]);
    if (currentChunk.length >= chunkSize) {
      const chunk = flushTemplateChunk(currentChunk, chunkStartLine, i + 1, ctx);
      if (chunk)
        chunks.push(chunk);
      currentChunk = currentChunk.slice(-chunkOverlap);
      chunkStartLine = Math.max(0, i + 1 - chunkOverlap);
    }
  }
  const finalChunk = flushTemplateChunk(currentChunk, chunkStartLine, lines.length, ctx);
  if (finalChunk)
    chunks.push(finalChunk);
  return chunks;
}
function chunkLiquidFile(filepath, content, chunkSize = 75, chunkOverlap = 10) {
  const contentWithoutComments = removeComments(content);
  const ctx = {
    lines: content.split("\n"),
    linesWithoutComments: contentWithoutComments.split("\n"),
    params: { filepath, chunkSize, chunkOverlap }
  };
  const blocks = findLiquidBlocks(content);
  const coveredLines = /* @__PURE__ */ new Set();
  const blockChunks = blocks.flatMap((block) => processSpecialBlock(block, ctx, coveredLines));
  const templateChunks = processTemplateContent(ctx, coveredLines);
  return [...blockChunks, ...templateChunks].sort((a, b) => a.metadata.startLine - b.metadata.startLine);
}

// ../core/dist/indexer/json-template-chunker.js
function extractSectionReferences(jsonContent) {
  try {
    const template = JSON.parse(jsonContent);
    const sectionTypes = /* @__PURE__ */ new Set();
    if (template.sections && typeof template.sections === "object") {
      for (const section of Object.values(template.sections)) {
        if (typeof section === "object" && section !== null && "type" in section && typeof section.type === "string") {
          sectionTypes.add(section.type);
        }
      }
    }
    return Array.from(sectionTypes);
  } catch (error2) {
    console.warn(`[Lien] Failed to parse JSON template: ${error2 instanceof Error ? error2.message : String(error2)}`);
    return [];
  }
}
function extractTemplateName(filepath) {
  const match2 = filepath.match(/templates\/(.+)\.json$/);
  return match2 ? match2[1] : void 0;
}
function chunkJSONTemplate(filepath, content) {
  if (content.trim().length === 0) {
    return [];
  }
  const lines = content.split("\n");
  const templateName = extractTemplateName(filepath);
  const sectionReferences = extractSectionReferences(content);
  return [{
    content,
    metadata: {
      file: filepath,
      startLine: 1,
      endLine: lines.length,
      language: "json",
      type: "template",
      symbolName: templateName,
      symbolType: "template",
      imports: sectionReferences.length > 0 ? sectionReferences : void 0
    }
  }];
}

// ../core/dist/indexer/chunker.js
function chunkFile(filepath, content, options = {}) {
  const { chunkSize = 75, chunkOverlap = 10, useAST = true, astFallback = "line-based" } = options;
  if (filepath.endsWith(".liquid")) {
    return chunkLiquidFile(filepath, content, chunkSize, chunkOverlap);
  }
  if (filepath.endsWith(".json") && /(?:^|\/)templates\//.test(filepath)) {
    return chunkJSONTemplate(filepath, content);
  }
  if (useAST && shouldUseAST(filepath)) {
    try {
      return chunkByAST(filepath, content, {
        minChunkSize: Math.floor(chunkSize / 10)
      });
    } catch (error2) {
      if (astFallback === "error") {
        throw new Error(`AST chunking failed for ${filepath}: ${error2 instanceof Error ? error2.message : String(error2)}`);
      }
      console.warn(`AST chunking failed for ${filepath}, falling back to line-based:`, error2);
    }
  }
  return chunkByLines(filepath, content, chunkSize, chunkOverlap);
}
function chunkByLines(filepath, content, chunkSize, chunkOverlap) {
  const lines = content.split("\n");
  const chunks = [];
  const language = detectLanguage(filepath);
  if (lines.length === 0 || lines.length === 1 && lines[0].trim() === "") {
    return chunks;
  }
  for (let i = 0; i < lines.length; i += chunkSize - chunkOverlap) {
    const endLine = Math.min(i + chunkSize, lines.length);
    const chunkLines = lines.slice(i, endLine);
    const chunkContent = chunkLines.join("\n");
    if (chunkContent.trim().length === 0) {
      continue;
    }
    const symbols = extractSymbols(chunkContent, language);
    chunks.push({
      content: chunkContent,
      metadata: {
        file: filepath,
        startLine: i + 1,
        endLine,
        type: "block",
        // MVP: all chunks are 'block' type
        language,
        symbols
      }
    });
    if (endLine >= lines.length) {
      break;
    }
  }
  return chunks;
}

// ../core/dist/embeddings/local.js
import { pipeline, env } from "@xenova/transformers";

// ../core/dist/errors/codes.js
var LienErrorCode;
(function(LienErrorCode2) {
  LienErrorCode2["CONFIG_NOT_FOUND"] = "CONFIG_NOT_FOUND";
  LienErrorCode2["CONFIG_INVALID"] = "CONFIG_INVALID";
  LienErrorCode2["INDEX_NOT_FOUND"] = "INDEX_NOT_FOUND";
  LienErrorCode2["INDEX_CORRUPTED"] = "INDEX_CORRUPTED";
  LienErrorCode2["EMBEDDING_MODEL_FAILED"] = "EMBEDDING_MODEL_FAILED";
  LienErrorCode2["EMBEDDING_GENERATION_FAILED"] = "EMBEDDING_GENERATION_FAILED";
  LienErrorCode2["FILE_NOT_FOUND"] = "FILE_NOT_FOUND";
  LienErrorCode2["FILE_NOT_READABLE"] = "FILE_NOT_READABLE";
  LienErrorCode2["INVALID_PATH"] = "INVALID_PATH";
  LienErrorCode2["INVALID_INPUT"] = "INVALID_INPUT";
  LienErrorCode2["INTERNAL_ERROR"] = "INTERNAL_ERROR";
})(LienErrorCode || (LienErrorCode = {}));

// ../core/dist/errors/index.js
var LienError = class extends Error {
  code;
  context;
  severity;
  recoverable;
  retryable;
  constructor(message, code, context, severity = "medium", recoverable = true, retryable = false) {
    super(message);
    this.code = code;
    this.context = context;
    this.severity = severity;
    this.recoverable = recoverable;
    this.retryable = retryable;
    this.name = "LienError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  /**
   * Serialize error to JSON for MCP responses
   */
  toJSON() {
    return {
      error: this.message,
      code: this.code,
      severity: this.severity,
      recoverable: this.recoverable,
      context: this.context
    };
  }
  /**
   * Check if this error is retryable
   */
  isRetryable() {
    return this.retryable;
  }
  /**
   * Check if this error is recoverable
   */
  isRecoverable() {
    return this.recoverable;
  }
};
var ConfigError = class extends LienError {
  constructor(message, context) {
    super(message, LienErrorCode.CONFIG_INVALID, context, "medium", true, false);
    this.name = "ConfigError";
  }
};
var EmbeddingError = class extends LienError {
  constructor(message, context) {
    super(message, LienErrorCode.EMBEDDING_GENERATION_FAILED, context, "high", true, true);
    this.name = "EmbeddingError";
  }
};
var DatabaseError = class extends LienError {
  constructor(message, context) {
    super(message, LienErrorCode.INTERNAL_ERROR, context, "high", true, true);
    this.name = "DatabaseError";
  }
};
function wrapError(error2, context, additionalContext) {
  const message = error2 instanceof Error ? error2.message : String(error2);
  const stack = error2 instanceof Error ? error2.stack : void 0;
  const wrappedError = new LienError(`${context}: ${message}`, LienErrorCode.INTERNAL_ERROR, additionalContext);
  if (stack) {
    wrappedError.stack = `${wrappedError.stack}

Caused by:
${stack}`;
  }
  return wrappedError;
}

// ../core/dist/constants.js
var DEFAULT_CHUNK_SIZE = 75;
var DEFAULT_CHUNK_OVERLAP = 10;
var DEFAULT_CONCURRENCY = 4;
var DEFAULT_EMBEDDING_BATCH_SIZE = 50;
var EMBEDDING_MICRO_BATCH_SIZE = 10;
var VECTOR_DB_MAX_BATCH_SIZE = 1e3;
var VECTOR_DB_MIN_BATCH_SIZE = 10;
var EMBEDDING_DIMENSIONS = 384;
var DEFAULT_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
var DEFAULT_PORT = 7133;
var DEFAULT_GIT_POLL_INTERVAL_MS = 1e4;
var DEFAULT_DEBOUNCE_MS = 1e3;
var CURRENT_CONFIG_VERSION = "0.19.5";
var INDEX_FORMAT_VERSION = 4;

// ../core/dist/embeddings/local.js
env.allowRemoteModels = true;
env.allowLocalModels = true;
var LocalEmbeddings = class {
  extractor = null;
  modelName = DEFAULT_EMBEDDING_MODEL;
  initPromise = null;
  async initialize() {
    if (this.initPromise) {
      return this.initPromise;
    }
    if (this.extractor) {
      return;
    }
    this.initPromise = (async () => {
      try {
        this.extractor = await pipeline("feature-extraction", this.modelName);
      } catch (error2) {
        this.initPromise = null;
        throw wrapError(error2, "Failed to initialize embedding model");
      }
    })();
    return this.initPromise;
  }
  async embed(text) {
    await this.initialize();
    if (!this.extractor) {
      throw new EmbeddingError("Embedding model not initialized");
    }
    try {
      const output = await this.extractor(text, {
        pooling: "mean",
        normalize: true
      });
      return output.data;
    } catch (error2) {
      throw wrapError(error2, "Failed to generate embedding", { textLength: text.length });
    }
  }
  async embedBatch(texts) {
    await this.initialize();
    if (!this.extractor) {
      throw new EmbeddingError("Embedding model not initialized");
    }
    try {
      const results = await Promise.all(texts.map((text) => this.embed(text)));
      return results;
    } catch (error2) {
      throw wrapError(error2, "Failed to generate batch embeddings", { batchSize: texts.length });
    }
  }
};

// ../core/dist/vectordb/lancedb.js
import * as lancedb from "@lancedb/lancedb";
import path6 from "path";
import os from "os";
import crypto from "crypto";

// ../core/dist/embeddings/types.js
var EMBEDDING_DIMENSION = EMBEDDING_DIMENSIONS;

// ../core/dist/vectordb/version.js
import fs2 from "fs/promises";
import path3 from "path";
var VERSION_FILE = ".lien-index-version";
async function writeVersionFile(indexPath) {
  try {
    const versionFilePath = path3.join(indexPath, VERSION_FILE);
    const timestamp = Date.now().toString();
    await fs2.writeFile(versionFilePath, timestamp, "utf-8");
  } catch (error2) {
    console.error(`Warning: Failed to write version file: ${error2}`);
  }
}
async function readVersionFile(indexPath) {
  try {
    const versionFilePath = path3.join(indexPath, VERSION_FILE);
    const content = await fs2.readFile(versionFilePath, "utf-8");
    const timestamp = parseInt(content.trim(), 10);
    return isNaN(timestamp) ? 0 : timestamp;
  } catch (error2) {
    return 0;
  }
}

// ../core/dist/vectordb/relevance.js
function calculateRelevance(score) {
  if (score < 1)
    return "highly_relevant";
  if (score < 1.3)
    return "relevant";
  if (score < 1.5)
    return "loosely_related";
  return "not_relevant";
}

// ../core/dist/vectordb/intent-classifier.js
var QueryIntent;
(function(QueryIntent2) {
  QueryIntent2["LOCATION"] = "location";
  QueryIntent2["CONCEPTUAL"] = "conceptual";
  QueryIntent2["IMPLEMENTATION"] = "implementation";
})(QueryIntent || (QueryIntent = {}));
var INTENT_RULES = [
  // LOCATION intent (highest priority - most specific)
  {
    intent: QueryIntent.LOCATION,
    priority: 3,
    patterns: [
      /where\s+(is|are|does|can\s+i\s+find)/,
      /find\s+the\s+/,
      /locate\s+/
    ]
  },
  // CONCEPTUAL intent (medium priority)
  {
    intent: QueryIntent.CONCEPTUAL,
    priority: 2,
    patterns: [
      /how\s+does\s+.*\s+work/,
      /what\s+(is|are|does)/,
      /explain\s+/,
      /understand\s+/,
      /\b(process|workflow|architecture)\b/
    ]
  },
  // IMPLEMENTATION intent (low priority - catches "how is X implemented")
  {
    intent: QueryIntent.IMPLEMENTATION,
    priority: 1,
    patterns: [
      /how\s+(is|are)\s+.*\s+(implemented|built|coded)/,
      /implementation\s+of/,
      /source\s+code\s+for/
    ]
  }
];
var INITIAL_RULE_COUNT = INTENT_RULES.length;
var cachedSortedRules = null;
function getSortedRules() {
  if (cachedSortedRules === null) {
    cachedSortedRules = [...INTENT_RULES].sort((a, b) => b.priority - a.priority);
  }
  return cachedSortedRules;
}
function classifyQueryIntent(query) {
  const lower = query.toLowerCase().trim();
  const sortedRules = getSortedRules();
  for (const rule of sortedRules) {
    if (rule.patterns.some((pattern) => pattern.test(lower))) {
      return rule.intent;
    }
  }
  return QueryIntent.IMPLEMENTATION;
}

// ../core/dist/vectordb/boosting/strategies.js
import path4 from "path";
function isDocumentationFile(filepath) {
  const lower = filepath.toLowerCase();
  const filename = path4.basename(filepath).toLowerCase();
  if (filename.startsWith("readme"))
    return true;
  if (filename.startsWith("changelog"))
    return true;
  if (filename.endsWith(".md") || filename.endsWith(".mdx") || filename.endsWith(".markdown")) {
    return true;
  }
  if (lower.includes("/docs/") || lower.includes("/documentation/") || lower.includes("/wiki/") || lower.includes("/.github/")) {
    return true;
  }
  if (lower.includes("architecture") || lower.includes("workflow") || lower.includes("/flow/")) {
    return true;
  }
  return false;
}
function isTestFile(filepath) {
  const lower = filepath.toLowerCase();
  if (lower.includes("/test/") || lower.includes("/tests/") || lower.includes("/__tests__/")) {
    return true;
  }
  if (lower.includes(".test.") || lower.includes(".spec.") || lower.includes("_test.") || lower.includes("_spec.")) {
    return true;
  }
  return false;
}
function isUtilityFile(filepath) {
  const lower = filepath.toLowerCase();
  if (lower.includes("/utils/") || lower.includes("/utilities/") || lower.includes("/helpers/") || lower.includes("/lib/")) {
    return true;
  }
  if (lower.includes(".util.") || lower.includes(".helper.") || lower.includes("-util.") || lower.includes("-helper.")) {
    return true;
  }
  return false;
}
var PathBoostingStrategy = class {
  name = "path-matching";
  apply(query, filepath, baseScore) {
    const queryTokens = query.toLowerCase().split(/\s+/);
    const pathSegments = filepath.toLowerCase().split("/");
    let boostFactor = 1;
    for (const token of queryTokens) {
      if (token.length <= 2)
        continue;
      if (pathSegments.some((seg) => seg.includes(token))) {
        boostFactor *= 0.9;
      }
    }
    return baseScore * boostFactor;
  }
};
var FilenameBoostingStrategy = class {
  name = "filename-matching";
  apply(query, filepath, baseScore) {
    const filename = path4.basename(filepath, path4.extname(filepath)).toLowerCase();
    const queryTokens = query.toLowerCase().split(/\s+/);
    let boostFactor = 1;
    for (const token of queryTokens) {
      if (token.length <= 2)
        continue;
      if (filename === token) {
        boostFactor *= 0.7;
      } else if (filename.includes(token)) {
        boostFactor *= 0.8;
      }
    }
    return baseScore * boostFactor;
  }
};
var FileTypeBoostingStrategy = class {
  intent;
  name = "file-type";
  constructor(intent) {
    this.intent = intent;
  }
  apply(query, filepath, baseScore) {
    switch (this.intent) {
      case QueryIntent.LOCATION:
        return this.applyLocationBoosting(query, filepath, baseScore);
      case QueryIntent.CONCEPTUAL:
        return this.applyConceptualBoosting(query, filepath, baseScore);
      case QueryIntent.IMPLEMENTATION:
        return this.applyImplementationBoosting(query, filepath, baseScore);
      default:
        return baseScore;
    }
  }
  applyLocationBoosting(_query, filepath, score) {
    if (isTestFile(filepath)) {
      score *= 1.1;
    }
    return score;
  }
  applyConceptualBoosting(_query, filepath, score) {
    if (isDocumentationFile(filepath)) {
      score *= 0.65;
      const lower = filepath.toLowerCase();
      if (lower.includes("architecture") || lower.includes("workflow") || lower.includes("flow")) {
        score *= 0.9;
      }
    }
    if (isUtilityFile(filepath)) {
      score *= 0.95;
    }
    return score;
  }
  applyImplementationBoosting(_query, filepath, score) {
    if (isTestFile(filepath)) {
      score *= 1.1;
    }
    return score;
  }
};

// ../core/dist/vectordb/boosting/composer.js
var BoostingComposer = class {
  strategies = [];
  /**
   * Add a boosting strategy to the pipeline.
   * Strategies are applied in the order they are added.
   *
   * @param strategy - The strategy to add
   * @returns This composer for chaining
   */
  addStrategy(strategy) {
    this.strategies.push(strategy);
    return this;
  }
  /**
   * Apply all strategies to a base score.
   *
   * @param query - The search query
   * @param filepath - The file path being scored
   * @param baseScore - The initial score from vector similarity
   * @returns The final boosted score after all strategies
   */
  apply(query, filepath, baseScore) {
    let score = baseScore;
    for (const strategy of this.strategies) {
      score = strategy.apply(query, filepath, score);
    }
    return score;
  }
  /**
   * Get the names of all strategies in this composer.
   * Useful for debugging and logging.
   */
  getStrategyNames() {
    return this.strategies.map((s) => s.name);
  }
  /**
   * Get the number of strategies in this composer.
   */
  getStrategyCount() {
    return this.strategies.length;
  }
  /**
   * Clear all strategies from this composer.
   */
  clear() {
    this.strategies = [];
  }
};

// ../core/dist/vectordb/query.js
var PATH_STRATEGY = new PathBoostingStrategy();
var FILENAME_STRATEGY = new FilenameBoostingStrategy();
var FILE_TYPE_STRATEGIES = {
  [QueryIntent.LOCATION]: new FileTypeBoostingStrategy(QueryIntent.LOCATION),
  [QueryIntent.CONCEPTUAL]: new FileTypeBoostingStrategy(QueryIntent.CONCEPTUAL),
  [QueryIntent.IMPLEMENTATION]: new FileTypeBoostingStrategy(QueryIntent.IMPLEMENTATION)
};
var BOOSTING_COMPOSERS = {
  [QueryIntent.LOCATION]: new BoostingComposer().addStrategy(PATH_STRATEGY).addStrategy(FILENAME_STRATEGY).addStrategy(FILE_TYPE_STRATEGIES[QueryIntent.LOCATION]),
  [QueryIntent.CONCEPTUAL]: new BoostingComposer().addStrategy(PATH_STRATEGY).addStrategy(FILENAME_STRATEGY).addStrategy(FILE_TYPE_STRATEGIES[QueryIntent.CONCEPTUAL]),
  [QueryIntent.IMPLEMENTATION]: new BoostingComposer().addStrategy(PATH_STRATEGY).addStrategy(FILENAME_STRATEGY).addStrategy(FILE_TYPE_STRATEGIES[QueryIntent.IMPLEMENTATION])
};
function isValidRecord(r) {
  return Boolean(r.content && r.content.trim().length > 0 && r.file && r.file.length > 0);
}
function hasValidArrayEntries(arr) {
  return Boolean(arr && arr.length > 0 && arr[0] !== "");
}
function getSymbolsForType(r, symbolType) {
  if (symbolType === "function")
    return r.functionNames || [];
  if (symbolType === "class")
    return r.classNames || [];
  if (symbolType === "interface")
    return r.interfaceNames || [];
  return [
    ...r.functionNames || [],
    ...r.classNames || [],
    ...r.interfaceNames || []
  ];
}
function buildSearchResultMetadata(r) {
  return {
    file: r.file,
    startLine: r.startLine,
    endLine: r.endLine,
    type: r.type,
    language: r.language,
    symbolName: r.symbolName || void 0,
    symbolType: r.symbolType,
    parentClass: r.parentClass || void 0,
    complexity: r.complexity || void 0,
    cognitiveComplexity: r.cognitiveComplexity || void 0,
    parameters: hasValidArrayEntries(r.parameters) ? r.parameters : void 0,
    signature: r.signature || void 0,
    imports: hasValidArrayEntries(r.imports) ? r.imports : void 0,
    // Halstead metrics (v0.19.0) - use explicit null check to preserve valid 0 values
    halsteadVolume: r.halsteadVolume != null ? r.halsteadVolume : void 0,
    halsteadDifficulty: r.halsteadDifficulty != null ? r.halsteadDifficulty : void 0,
    halsteadEffort: r.halsteadEffort != null ? r.halsteadEffort : void 0,
    halsteadBugs: r.halsteadBugs != null ? r.halsteadBugs : void 0
  };
}
function applyRelevanceBoosting(query, filepath, baseScore) {
  if (!query) {
    return baseScore;
  }
  const intent = classifyQueryIntent(query);
  return BOOSTING_COMPOSERS[intent].apply(query, filepath, baseScore);
}
function dbRecordToSearchResult(r, query) {
  const baseScore = r._distance ?? 0;
  const boostedScore = applyRelevanceBoosting(query, r.file, baseScore);
  return {
    content: r.content,
    metadata: buildSearchResultMetadata(r),
    score: boostedScore,
    relevance: calculateRelevance(boostedScore)
  };
}
async function search(table, queryVector, limit = 5, query) {
  if (!table) {
    throw new DatabaseError("Vector database not initialized");
  }
  try {
    const results = await table.search(Array.from(queryVector)).limit(limit + 20).toArray();
    const filtered = results.filter(isValidRecord).map((r) => dbRecordToSearchResult(r, query)).sort((a, b) => a.score - b.score).slice(0, limit);
    return filtered;
  } catch (error2) {
    const errorMsg = String(error2);
    if (errorMsg.includes("Not found:") || errorMsg.includes(".lance")) {
      throw new DatabaseError(`Index appears corrupted or outdated. Please restart the MCP server or run 'lien reindex' in the project directory.`, { originalError: error2 });
    }
    throw wrapError(error2, "Failed to search vector database");
  }
}
async function scanWithFilter(table, options) {
  if (!table) {
    throw new DatabaseError("Vector database not initialized");
  }
  const { language, pattern, limit = 100 } = options;
  try {
    const zeroVector = Array(EMBEDDING_DIMENSION).fill(0);
    const query = table.search(zeroVector).where('file != ""').limit(Math.max(limit * 5, 200));
    const results = await query.toArray();
    let filtered = results.filter(isValidRecord);
    if (language) {
      filtered = filtered.filter((r) => r.language && r.language.toLowerCase() === language.toLowerCase());
    }
    if (pattern) {
      const regex = new RegExp(pattern, "i");
      filtered = filtered.filter((r) => regex.test(r.content) || regex.test(r.file));
    }
    return filtered.slice(0, limit).map((r) => ({
      content: r.content,
      metadata: buildSearchResultMetadata(r),
      score: 0,
      relevance: calculateRelevance(0)
    }));
  } catch (error2) {
    throw wrapError(error2, "Failed to scan with filter");
  }
}
var SYMBOL_TYPE_MATCHES = {
  function: /* @__PURE__ */ new Set(["function", "method"]),
  class: /* @__PURE__ */ new Set(["class"]),
  interface: /* @__PURE__ */ new Set(["interface"])
};
function matchesSymbolType(record, symbolType, symbols) {
  if (record.symbolType) {
    return SYMBOL_TYPE_MATCHES[symbolType]?.has(record.symbolType) ?? false;
  }
  return symbols.length > 0 && symbols.some((s) => s.length > 0 && s !== "");
}
function matchesSymbolFilter(r, { language, pattern, symbolType }) {
  if (language && (!r.language || r.language.toLowerCase() !== language.toLowerCase())) {
    return false;
  }
  const symbols = getSymbolsForType(r, symbolType);
  const astSymbolName = r.symbolName || "";
  if (symbols.length === 0 && !astSymbolName) {
    return false;
  }
  if (pattern) {
    const regex = new RegExp(pattern, "i");
    const nameMatches = symbols.some((s) => regex.test(s)) || regex.test(astSymbolName);
    if (!nameMatches)
      return false;
  }
  if (symbolType) {
    return matchesSymbolType(r, symbolType, symbols);
  }
  return true;
}
function buildLegacySymbols2(r) {
  return {
    functions: hasValidArrayEntries(r.functionNames) ? r.functionNames : [],
    classes: hasValidArrayEntries(r.classNames) ? r.classNames : [],
    interfaces: hasValidArrayEntries(r.interfaceNames) ? r.interfaceNames : []
  };
}
async function querySymbols(table, options) {
  if (!table) {
    throw new DatabaseError("Vector database not initialized");
  }
  const { language, pattern, symbolType, limit = 50 } = options;
  const filterOpts = { language, pattern, symbolType };
  try {
    const zeroVector = Array(EMBEDDING_DIMENSION).fill(0);
    const query = table.search(zeroVector).where('file != ""').limit(Math.max(limit * 10, 500));
    const results = await query.toArray();
    const filtered = results.filter((r) => isValidRecord(r) && matchesSymbolFilter(r, filterOpts));
    return filtered.slice(0, limit).map((r) => ({
      content: r.content,
      metadata: {
        ...buildSearchResultMetadata(r),
        symbols: buildLegacySymbols2(r)
      },
      score: 0,
      relevance: calculateRelevance(0)
    }));
  } catch (error2) {
    throw wrapError(error2, "Failed to query symbols");
  }
}
async function scanAll(table, options = {}) {
  if (!table) {
    throw new DatabaseError("Vector database not initialized");
  }
  try {
    const totalRows = await table.countRows();
    const MIN_SCAN_LIMIT = 1e3;
    const results = await scanWithFilter(table, {
      ...options,
      limit: Math.max(totalRows, MIN_SCAN_LIMIT)
    });
    return results;
  } catch (error2) {
    throw wrapError(error2, "Failed to scan all chunks");
  }
}

// ../core/dist/vectordb/batch-insert.js
function transformChunkToRecord(vector, content, metadata) {
  return {
    vector: Array.from(vector),
    content,
    file: metadata.file,
    startLine: metadata.startLine,
    endLine: metadata.endLine,
    type: metadata.type,
    language: metadata.language,
    // Ensure arrays have at least empty string for Arrow type inference
    functionNames: getNonEmptyArray(metadata.symbols?.functions),
    classNames: getNonEmptyArray(metadata.symbols?.classes),
    interfaceNames: getNonEmptyArray(metadata.symbols?.interfaces),
    // AST-derived metadata (v0.13.0)
    symbolName: metadata.symbolName || "",
    symbolType: metadata.symbolType || "",
    parentClass: metadata.parentClass || "",
    complexity: metadata.complexity || 0,
    cognitiveComplexity: metadata.cognitiveComplexity || 0,
    parameters: getNonEmptyArray(metadata.parameters),
    signature: metadata.signature || "",
    imports: getNonEmptyArray(metadata.imports),
    // Halstead metrics (v0.19.0)
    halsteadVolume: metadata.halsteadVolume || 0,
    halsteadDifficulty: metadata.halsteadDifficulty || 0,
    halsteadEffort: metadata.halsteadEffort || 0,
    halsteadBugs: metadata.halsteadBugs || 0
  };
}
function getNonEmptyArray(arr) {
  return arr && arr.length > 0 ? arr : [""];
}
function splitBatchInHalf(batch) {
  const half = Math.floor(batch.vectors.length / 2);
  return [
    {
      vectors: batch.vectors.slice(0, half),
      metadatas: batch.metadatas.slice(0, half),
      contents: batch.contents.slice(0, half)
    },
    {
      vectors: batch.vectors.slice(half),
      metadatas: batch.metadatas.slice(half),
      contents: batch.contents.slice(half)
    }
  ];
}
function transformBatchToRecords(batch) {
  return batch.vectors.map((vector, i) => transformChunkToRecord(vector, batch.contents[i], batch.metadatas[i]));
}
async function insertBatch(db, table, tableName, vectors, metadatas, contents) {
  if (!db) {
    throw new DatabaseError("Vector database not initialized");
  }
  if (vectors.length !== metadatas.length || vectors.length !== contents.length) {
    throw new DatabaseError("Vectors, metadatas, and contents arrays must have the same length", {
      vectorsLength: vectors.length,
      metadatasLength: metadatas.length,
      contentsLength: contents.length
    });
  }
  if (vectors.length === 0) {
    return table;
  }
  if (vectors.length > VECTOR_DB_MAX_BATCH_SIZE) {
    let currentTable = table;
    for (let i = 0; i < vectors.length; i += VECTOR_DB_MAX_BATCH_SIZE) {
      const batchVectors = vectors.slice(i, Math.min(i + VECTOR_DB_MAX_BATCH_SIZE, vectors.length));
      const batchMetadata = metadatas.slice(i, Math.min(i + VECTOR_DB_MAX_BATCH_SIZE, vectors.length));
      const batchContents = contents.slice(i, Math.min(i + VECTOR_DB_MAX_BATCH_SIZE, vectors.length));
      currentTable = await insertBatchInternal(db, currentTable, tableName, batchVectors, batchMetadata, batchContents);
    }
    if (!currentTable) {
      throw new DatabaseError("Failed to create table during batch insert");
    }
    return currentTable;
  } else {
    return insertBatchInternal(db, table, tableName, vectors, metadatas, contents);
  }
}
async function insertBatchInternal(db, table, tableName, vectors, metadatas, contents) {
  const queue = [{ vectors, metadatas, contents }];
  const failedBatches = [];
  let currentTable = table;
  let lastError;
  while (queue.length > 0) {
    const batch = queue.shift();
    const insertResult = await tryInsertBatch(db, currentTable, tableName, batch);
    if (insertResult.success) {
      currentTable = insertResult.table;
    } else {
      lastError = insertResult.error;
      handleBatchFailure(batch, queue, failedBatches);
    }
  }
  throwIfBatchesFailed(failedBatches, lastError);
  if (!currentTable) {
    throw new DatabaseError("Failed to create table during batch insert");
  }
  return currentTable;
}
async function tryInsertBatch(db, currentTable, tableName, batch) {
  try {
    const records = transformBatchToRecords(batch);
    if (!currentTable) {
      const newTable = await db.createTable(tableName, records);
      return { success: true, table: newTable };
    } else {
      await currentTable.add(records);
      return { success: true, table: currentTable };
    }
  } catch (error2) {
    return { success: false, table: currentTable, error: error2 };
  }
}
function handleBatchFailure(batch, queue, failedBatches) {
  if (batch.vectors.length > VECTOR_DB_MIN_BATCH_SIZE) {
    const [firstHalf, secondHalf] = splitBatchInHalf(batch);
    queue.push(firstHalf, secondHalf);
  } else {
    failedBatches.push(batch);
  }
}
function throwIfBatchesFailed(failedBatches, lastError) {
  if (failedBatches.length === 0)
    return;
  const totalFailed = failedBatches.reduce((sum, batch) => sum + batch.vectors.length, 0);
  throw new DatabaseError(`Failed to insert ${totalFailed} record(s) after retry attempts`, {
    failedBatches: failedBatches.length,
    totalRecords: totalFailed,
    sampleFile: failedBatches[0].metadatas[0].file,
    lastError: lastError?.message
  });
}

// ../core/dist/vectordb/maintenance.js
import fs3 from "fs/promises";
import path5 from "path";
async function clear(db, table, tableName, dbPath) {
  if (!db) {
    throw new DatabaseError("Vector database not initialized");
  }
  try {
    if (dbPath) {
      const lanceDir = path5.join(dbPath, `${tableName}.lance`);
      try {
        await fs3.rm(lanceDir, { recursive: true, force: true });
      } catch (err) {
        if (err?.code === "ENOTEMPTY" || err?.message?.includes("not empty")) {
          try {
            await db.dropTable(tableName);
            await fs3.rm(lanceDir, { recursive: true, force: true });
          } catch {
          }
        }
      }
    } else {
      if (table) {
        await db.dropTable(tableName);
      }
    }
  } catch (error2) {
    throw wrapError(error2, "Failed to clear vector database");
  }
}
async function deleteByFile(table, filepath) {
  if (!table) {
    throw new DatabaseError("Vector database not initialized");
  }
  try {
    await table.delete(`file = "${filepath}"`);
  } catch (error2) {
    throw wrapError(error2, "Failed to delete file from vector database");
  }
}
async function updateFile(db, table, tableName, dbPath, filepath, vectors, metadatas, contents) {
  if (!table) {
    throw new DatabaseError("Vector database not initialized");
  }
  try {
    await deleteByFile(table, filepath);
    let updatedTable = table;
    if (vectors.length > 0) {
      updatedTable = await insertBatch(db, table, tableName, vectors, metadatas, contents);
      if (!updatedTable) {
        throw new DatabaseError("insertBatch unexpectedly returned null");
      }
    }
    await writeVersionFile(dbPath);
    return updatedTable;
  } catch (error2) {
    throw wrapError(error2, "Failed to update file in vector database");
  }
}

// ../core/dist/vectordb/lancedb.js
var VectorDB = class _VectorDB {
  db = null;
  table = null;
  dbPath;
  tableName = "code_chunks";
  lastVersionCheck = 0;
  currentVersion = 0;
  constructor(projectRoot) {
    const projectName = path6.basename(projectRoot);
    const pathHash = crypto.createHash("md5").update(projectRoot).digest("hex").substring(0, 8);
    this.dbPath = path6.join(os.homedir(), ".lien", "indices", `${projectName}-${pathHash}`);
  }
  async initialize() {
    try {
      this.db = await lancedb.connect(this.dbPath);
      try {
        this.table = await this.db.openTable(this.tableName);
      } catch {
        this.table = null;
      }
      try {
        this.currentVersion = await readVersionFile(this.dbPath);
      } catch {
        this.currentVersion = 0;
      }
    } catch (error2) {
      throw wrapError(error2, "Failed to initialize vector database", { dbPath: this.dbPath });
    }
  }
  async insertBatch(vectors, metadatas, contents) {
    if (!this.db) {
      throw new DatabaseError("Vector database not initialized");
    }
    this.table = await insertBatch(this.db, this.table, this.tableName, vectors, metadatas, contents);
  }
  async search(queryVector, limit = 5, query) {
    if (!this.table) {
      throw new DatabaseError("Vector database not initialized");
    }
    try {
      return await search(this.table, queryVector, limit, query);
    } catch (error2) {
      const errorMsg = String(error2);
      if (errorMsg.includes("Not found:") || errorMsg.includes(".lance")) {
        try {
          await this.initialize();
          if (!this.table) {
            throw new DatabaseError("Vector database not initialized after reconnection");
          }
          return await search(this.table, queryVector, limit, query);
        } catch (retryError) {
          throw new DatabaseError(`Index appears corrupted or outdated. Please restart the MCP server or run 'lien reindex' in the project directory.`, { originalError: retryError });
        }
      }
      throw error2;
    }
  }
  async scanWithFilter(options) {
    if (!this.table) {
      throw new DatabaseError("Vector database not initialized");
    }
    return scanWithFilter(this.table, options);
  }
  /**
   * Scan all chunks in the database
   * Fetches total count first, then retrieves all chunks in a single optimized query
   * @param options - Filter options (language, pattern)
   * @returns All matching chunks
   */
  async scanAll(options = {}) {
    if (!this.table) {
      throw new DatabaseError("Vector database not initialized");
    }
    return scanAll(this.table, options);
  }
  async querySymbols(options) {
    if (!this.table) {
      throw new DatabaseError("Vector database not initialized");
    }
    return querySymbols(this.table, options);
  }
  async clear() {
    if (!this.db) {
      throw new DatabaseError("Vector database not initialized");
    }
    this.table = null;
    await clear(this.db, null, this.tableName, this.dbPath);
  }
  async deleteByFile(filepath) {
    if (!this.table) {
      throw new DatabaseError("Vector database not initialized");
    }
    await deleteByFile(this.table, filepath);
  }
  async updateFile(filepath, vectors, metadatas, contents) {
    if (!this.db) {
      throw new DatabaseError("Vector database connection not initialized");
    }
    if (!this.table) {
      throw new DatabaseError("Vector database table not initialized");
    }
    this.table = await updateFile(this.db, this.table, this.tableName, this.dbPath, filepath, vectors, metadatas, contents);
  }
  async checkVersion() {
    const now = Date.now();
    if (now - this.lastVersionCheck < 1e3) {
      return false;
    }
    this.lastVersionCheck = now;
    try {
      const version = await readVersionFile(this.dbPath);
      if (version > this.currentVersion) {
        this.currentVersion = version;
        return true;
      }
      return false;
    } catch (error2) {
      return false;
    }
  }
  async reconnect() {
    try {
      this.table = null;
      this.db = null;
      await this.initialize();
    } catch (error2) {
      throw wrapError(error2, "Failed to reconnect to vector database");
    }
  }
  getCurrentVersion() {
    return this.currentVersion;
  }
  getVersionDate() {
    if (this.currentVersion === 0) {
      return "Unknown";
    }
    return new Date(this.currentVersion).toLocaleString();
  }
  async hasData() {
    if (!this.table) {
      return false;
    }
    try {
      const count = await this.table.countRows();
      if (count === 0) {
        return false;
      }
      const sample = await this.table.search(Array(EMBEDDING_DIMENSION).fill(0)).limit(Math.min(count, 5)).toArray();
      const hasRealData = sample.some((r) => r.content && r.content.trim().length > 0);
      return hasRealData;
    } catch {
      return false;
    }
  }
  static async load(projectRoot) {
    const db = new _VectorDB(projectRoot);
    await db.initialize();
    return db;
  }
};

// ../core/dist/config/service.js
import fs4 from "fs/promises";
import path7 from "path";

// ../core/dist/config/schema.js
function isLegacyConfig(config) {
  return "indexing" in config && !("frameworks" in config);
}
function isModernConfig(config) {
  return "frameworks" in config;
}
var defaultConfig = {
  version: CURRENT_CONFIG_VERSION,
  core: {
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    concurrency: DEFAULT_CONCURRENCY,
    embeddingBatchSize: DEFAULT_EMBEDDING_BATCH_SIZE
  },
  chunking: {
    useAST: true,
    // AST-based chunking enabled by default (v0.13.0)
    astFallback: "line-based"
    // Fallback to line-based on errors
  },
  mcp: {
    port: DEFAULT_PORT,
    transport: "stdio",
    autoIndexOnFirstRun: true
  },
  gitDetection: {
    enabled: true,
    pollIntervalMs: DEFAULT_GIT_POLL_INTERVAL_MS
  },
  fileWatching: {
    enabled: true,
    // Enabled by default (fast with incremental indexing!)
    debounceMs: DEFAULT_DEBOUNCE_MS
  },
  complexity: {
    enabled: true,
    thresholds: {
      testPaths: 15,
      // 🔀 Max test paths per function
      mentalLoad: 15,
      // 🧠 Max mental load score
      timeToUnderstandMinutes: 60,
      // ⏱️ Functions taking >1 hour to understand
      estimatedBugs: 1.5
      // 🐛 Functions estimated to have >1.5 bugs
    }
  },
  frameworks: []
  // Will be populated by lien init via framework detection
};

// ../core/dist/config/merge.js
function deepMergeConfig(defaults2, user) {
  return {
    version: user.version ?? defaults2.version,
    core: {
      ...defaults2.core,
      ...user.core
    },
    chunking: {
      ...defaults2.chunking,
      ...user.chunking
    },
    mcp: {
      ...defaults2.mcp,
      ...user.mcp
    },
    gitDetection: {
      ...defaults2.gitDetection,
      ...user.gitDetection
    },
    fileWatching: {
      ...defaults2.fileWatching,
      ...user.fileWatching
    },
    complexity: user.complexity ? {
      enabled: user.complexity.enabled ?? defaults2.complexity?.enabled ?? true,
      thresholds: {
        ...defaults2.complexity?.thresholds,
        ...user.complexity.thresholds || {}
      }
    } : defaults2.complexity,
    frameworks: user.frameworks ?? defaults2.frameworks
  };
}

// ../core/dist/config/migration.js
function needsMigration(config) {
  if (!config) {
    return false;
  }
  if (config.frameworks !== void 0 && !config.chunking) {
    return true;
  }
  if (config.frameworks !== void 0 && config.chunking !== void 0) {
    return false;
  }
  if (config.indexing !== void 0) {
    return true;
  }
  if (config.version && config.version.startsWith("0.2")) {
    return true;
  }
  return false;
}
function migrateConfig(oldConfig, targetVersion) {
  const newConfig = {
    version: targetVersion ?? CURRENT_CONFIG_VERSION,
    core: {
      chunkSize: oldConfig.indexing?.chunkSize ?? oldConfig.core?.chunkSize ?? defaultConfig.core.chunkSize,
      chunkOverlap: oldConfig.indexing?.chunkOverlap ?? oldConfig.core?.chunkOverlap ?? defaultConfig.core.chunkOverlap,
      concurrency: oldConfig.indexing?.concurrency ?? oldConfig.core?.concurrency ?? defaultConfig.core.concurrency,
      embeddingBatchSize: oldConfig.indexing?.embeddingBatchSize ?? oldConfig.core?.embeddingBatchSize ?? defaultConfig.core.embeddingBatchSize
    },
    chunking: {
      useAST: oldConfig.chunking?.useAST ?? defaultConfig.chunking.useAST,
      astFallback: oldConfig.chunking?.astFallback ?? defaultConfig.chunking.astFallback
    },
    mcp: {
      port: oldConfig.mcp?.port ?? defaultConfig.mcp.port,
      transport: oldConfig.mcp?.transport ?? defaultConfig.mcp.transport,
      autoIndexOnFirstRun: oldConfig.mcp?.autoIndexOnFirstRun ?? defaultConfig.mcp.autoIndexOnFirstRun
    },
    gitDetection: {
      enabled: oldConfig.gitDetection?.enabled ?? defaultConfig.gitDetection.enabled,
      pollIntervalMs: oldConfig.gitDetection?.pollIntervalMs ?? defaultConfig.gitDetection.pollIntervalMs
    },
    fileWatching: {
      enabled: oldConfig.fileWatching?.enabled ?? defaultConfig.fileWatching.enabled,
      debounceMs: oldConfig.fileWatching?.debounceMs ?? defaultConfig.fileWatching.debounceMs
    },
    frameworks: oldConfig.frameworks ?? []
  };
  if (oldConfig.indexing && newConfig.frameworks.length === 0) {
    const genericFramework = {
      name: "generic",
      path: ".",
      enabled: true,
      config: {
        include: oldConfig.indexing.include ?? ["**/*.{ts,tsx,js,jsx,py,php,go,rs,java,c,cpp,cs}"],
        exclude: oldConfig.indexing.exclude ?? [
          "**/node_modules/**",
          "**/dist/**",
          "**/build/**",
          "**/.git/**",
          "**/coverage/**",
          "**/.next/**",
          "**/.nuxt/**",
          "**/vendor/**"
        ]
      }
    };
    newConfig.frameworks.push(genericFramework);
  } else if (newConfig.frameworks.length === 0) {
    const genericFramework = {
      name: "generic",
      path: ".",
      enabled: true,
      config: {
        include: ["**/*.{ts,tsx,js,jsx,py,php,go,rs,java,c,cpp,cs}"],
        exclude: [
          "**/node_modules/**",
          "**/dist/**",
          "**/build/**",
          "**/.git/**",
          "**/coverage/**",
          "**/.next/**",
          "**/.nuxt/**",
          "**/vendor/**"
        ]
      }
    };
    newConfig.frameworks.push(genericFramework);
  }
  return newConfig;
}

// ../core/dist/config/service.js
var ConfigService = class _ConfigService {
  static CONFIG_FILENAME = ".lien.config.json";
  /**
   * Load configuration from the specified directory.
   * Automatically handles migration if needed.
   *
   * @param rootDir - Root directory containing the config file
   * @returns Loaded and validated configuration
   * @throws {ConfigError} If config is invalid or cannot be loaded
   */
  async load(rootDir = process.cwd()) {
    const configPath = this.getConfigPath(rootDir);
    try {
      const configContent = await fs4.readFile(configPath, "utf-8");
      const userConfig = JSON.parse(configContent);
      if (this.needsMigration(userConfig)) {
        console.log("\u{1F504} Migrating config from v0.2.0 to v0.3.0...");
        const result = await this.migrate(rootDir);
        if (result.migrated && result.backupPath) {
          const backupFilename = path7.basename(result.backupPath);
          console.log(`\u2705 Migration complete! Backup saved as ${backupFilename}`);
          console.log("\u{1F4DD} Your config now uses the framework-based structure.");
        }
        return result.config;
      }
      const mergedConfig = deepMergeConfig(defaultConfig, userConfig);
      const validation = this.validate(mergedConfig);
      if (!validation.valid) {
        throw new ConfigError(`Invalid configuration:
${validation.errors.join("\n")}`, { errors: validation.errors, warnings: validation.warnings });
      }
      if (validation.warnings.length > 0) {
        console.warn("\u26A0\uFE0F  Configuration warnings:");
        validation.warnings.forEach((warning4) => console.warn(`   ${warning4}`));
      }
      return mergedConfig;
    } catch (error2) {
      if (error2.code === "ENOENT") {
        return defaultConfig;
      }
      if (error2 instanceof ConfigError) {
        throw error2;
      }
      if (error2 instanceof SyntaxError) {
        throw new ConfigError("Failed to parse config file: Invalid JSON syntax", { path: configPath, originalError: error2.message });
      }
      throw wrapError(error2, "Failed to load configuration", { path: configPath });
    }
  }
  /**
   * Save configuration to the specified directory.
   * Validates the config before saving.
   *
   * @param rootDir - Root directory to save the config file
   * @param config - Configuration to save
   * @throws {ConfigError} If config is invalid or cannot be saved
   */
  async save(rootDir, config) {
    const configPath = this.getConfigPath(rootDir);
    const validation = this.validate(config);
    if (!validation.valid) {
      throw new ConfigError(`Cannot save invalid configuration:
${validation.errors.join("\n")}`, { errors: validation.errors });
    }
    try {
      const configJson = JSON.stringify(config, null, 2) + "\n";
      await fs4.writeFile(configPath, configJson, "utf-8");
    } catch (error2) {
      throw wrapError(error2, "Failed to save configuration", { path: configPath });
    }
  }
  /**
   * Check if a configuration file exists in the specified directory.
   *
   * @param rootDir - Root directory to check
   * @returns True if config file exists
   */
  async exists(rootDir = process.cwd()) {
    const configPath = this.getConfigPath(rootDir);
    try {
      await fs4.access(configPath);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Migrate configuration from v0.2.0 to v0.3.0 format.
   * Creates a backup of the original config file.
   *
   * @param rootDir - Root directory containing the config file
   * @returns Migration result with status and new config
   * @throws {ConfigError} If migration fails
   */
  async migrate(rootDir = process.cwd()) {
    const configPath = this.getConfigPath(rootDir);
    try {
      const configContent = await fs4.readFile(configPath, "utf-8");
      const oldConfig = JSON.parse(configContent);
      if (!this.needsMigration(oldConfig)) {
        return {
          migrated: false,
          config: oldConfig
        };
      }
      const newConfig = migrateConfig(oldConfig);
      const validation = this.validate(newConfig);
      if (!validation.valid) {
        throw new ConfigError(`Migration produced invalid configuration:
${validation.errors.join("\n")}`, { errors: validation.errors });
      }
      const backupPath = `${configPath}.v0.2.0.backup`;
      await fs4.copyFile(configPath, backupPath);
      await this.save(rootDir, newConfig);
      return {
        migrated: true,
        backupPath,
        config: newConfig
      };
    } catch (error2) {
      if (error2.code === "ENOENT") {
        return {
          migrated: false,
          config: defaultConfig
        };
      }
      if (error2 instanceof ConfigError) {
        throw error2;
      }
      throw wrapError(error2, "Configuration migration failed", { path: configPath });
    }
  }
  /**
   * Check if a config object needs migration from v0.2.0 to v0.3.0.
   *
   * @param config - Config object to check
   * @returns True if migration is needed
   */
  needsMigration(config) {
    return needsMigration(config);
  }
  /**
   * Validate a configuration object.
   * Checks all constraints and returns detailed validation results.
   *
   * @param config - Configuration to validate
   * @returns Validation result with errors and warnings
   */
  validate(config) {
    const errors = [];
    const warnings = [];
    if (!config || typeof config !== "object") {
      return {
        valid: false,
        errors: ["Configuration must be an object"],
        warnings: []
      };
    }
    const cfg = config;
    if (!cfg.version) {
      errors.push("Missing required field: version");
    }
    if (isModernConfig(cfg)) {
      this.validateModernConfig(cfg, errors, warnings);
    } else if (isLegacyConfig(cfg)) {
      this.validateLegacyConfig(cfg, errors, warnings);
    } else {
      errors.push('Configuration format not recognized. Must have either "frameworks" or "indexing" field');
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  /**
   * Validate a partial configuration object.
   * Useful for validating user input before merging with defaults.
   *
   * @param config - Partial configuration to validate
   * @returns Validation result with errors and warnings
   */
  validatePartial(config) {
    const errors = [];
    const warnings = [];
    if (config.core) {
      this.validateCoreConfig(config.core, errors, warnings);
    }
    if (config.mcp) {
      this.validateMCPConfig(config.mcp, errors, warnings);
    }
    if (config.gitDetection) {
      this.validateGitDetectionConfig(config.gitDetection, errors, warnings);
    }
    if (config.fileWatching) {
      this.validateFileWatchingConfig(config.fileWatching, errors, warnings);
    }
    if (config.frameworks) {
      this.validateFrameworks(config.frameworks, errors, warnings);
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  /**
   * Get the full path to the config file
   */
  getConfigPath(rootDir) {
    return path7.join(rootDir, _ConfigService.CONFIG_FILENAME);
  }
  /**
   * Validate modern (v0.3.0+) configuration
   */
  validateModernConfig(config, errors, warnings) {
    if (!config.core) {
      errors.push("Missing required field: core");
      return;
    }
    this.validateCoreConfig(config.core, errors, warnings);
    if (!config.mcp) {
      errors.push("Missing required field: mcp");
      return;
    }
    this.validateMCPConfig(config.mcp, errors, warnings);
    if (!config.gitDetection) {
      errors.push("Missing required field: gitDetection");
      return;
    }
    this.validateGitDetectionConfig(config.gitDetection, errors, warnings);
    if (!config.fileWatching) {
      errors.push("Missing required field: fileWatching");
      return;
    }
    this.validateFileWatchingConfig(config.fileWatching, errors, warnings);
    if (!config.frameworks) {
      errors.push("Missing required field: frameworks");
      return;
    }
    this.validateFrameworks(config.frameworks, errors, warnings);
  }
  /**
   * Validate legacy (v0.2.0) configuration
   */
  validateLegacyConfig(config, errors, warnings) {
    warnings.push('Using legacy configuration format. Consider running "lien init" to migrate to v0.3.0');
    if (!config.indexing) {
      errors.push("Missing required field: indexing");
      return;
    }
    const { indexing } = config;
    if (typeof indexing.chunkSize !== "number" || indexing.chunkSize <= 0) {
      errors.push("indexing.chunkSize must be a positive number");
    }
    if (typeof indexing.chunkOverlap !== "number" || indexing.chunkOverlap < 0) {
      errors.push("indexing.chunkOverlap must be a non-negative number");
    }
    if (typeof indexing.concurrency !== "number" || indexing.concurrency < 1 || indexing.concurrency > 16) {
      errors.push("indexing.concurrency must be between 1 and 16");
    }
    if (typeof indexing.embeddingBatchSize !== "number" || indexing.embeddingBatchSize <= 0) {
      errors.push("indexing.embeddingBatchSize must be a positive number");
    }
    if (config.mcp) {
      this.validateMCPConfig(config.mcp, errors, warnings);
    }
  }
  /**
   * Validate core configuration settings
   */
  validateCoreConfig(core5, errors, warnings) {
    if (core5.chunkSize !== void 0) {
      if (typeof core5.chunkSize !== "number" || core5.chunkSize <= 0) {
        errors.push("core.chunkSize must be a positive number");
      } else if (core5.chunkSize < 50) {
        warnings.push("core.chunkSize is very small (<50 lines). This may result in poor search quality");
      } else if (core5.chunkSize > 500) {
        warnings.push("core.chunkSize is very large (>500 lines). This may impact performance");
      }
    }
    if (core5.chunkOverlap !== void 0) {
      if (typeof core5.chunkOverlap !== "number" || core5.chunkOverlap < 0) {
        errors.push("core.chunkOverlap must be a non-negative number");
      }
    }
    if (core5.concurrency !== void 0) {
      if (typeof core5.concurrency !== "number" || core5.concurrency < 1 || core5.concurrency > 16) {
        errors.push("core.concurrency must be between 1 and 16");
      }
    }
    if (core5.embeddingBatchSize !== void 0) {
      if (typeof core5.embeddingBatchSize !== "number" || core5.embeddingBatchSize <= 0) {
        errors.push("core.embeddingBatchSize must be a positive number");
      } else if (core5.embeddingBatchSize > 100) {
        warnings.push("core.embeddingBatchSize is very large (>100). This may cause memory issues");
      }
    }
  }
  /**
   * Validate MCP configuration settings
   */
  validateMCPConfig(mcp, errors, _warnings) {
    if (mcp.port !== void 0) {
      if (typeof mcp.port !== "number" || mcp.port < 1024 || mcp.port > 65535) {
        errors.push("mcp.port must be between 1024 and 65535");
      }
    }
    if (mcp.transport !== void 0) {
      if (mcp.transport !== "stdio" && mcp.transport !== "socket") {
        errors.push('mcp.transport must be either "stdio" or "socket"');
      }
    }
    if (mcp.autoIndexOnFirstRun !== void 0) {
      if (typeof mcp.autoIndexOnFirstRun !== "boolean") {
        errors.push("mcp.autoIndexOnFirstRun must be a boolean");
      }
    }
  }
  /**
   * Validate git detection configuration settings
   */
  validateGitDetectionConfig(gitDetection, errors, _warnings) {
    if (gitDetection.enabled !== void 0) {
      if (typeof gitDetection.enabled !== "boolean") {
        errors.push("gitDetection.enabled must be a boolean");
      }
    }
    if (gitDetection.pollIntervalMs !== void 0) {
      if (typeof gitDetection.pollIntervalMs !== "number" || gitDetection.pollIntervalMs < 100) {
        errors.push("gitDetection.pollIntervalMs must be at least 100ms");
      } else if (gitDetection.pollIntervalMs < 1e3) {
        _warnings.push("gitDetection.pollIntervalMs is very short (<1s). This may impact performance");
      }
    }
  }
  /**
   * Validate file watching configuration settings
   */
  validateFileWatchingConfig(fileWatching, errors, warnings) {
    if (fileWatching.enabled !== void 0) {
      if (typeof fileWatching.enabled !== "boolean") {
        errors.push("fileWatching.enabled must be a boolean");
      }
    }
    if (fileWatching.debounceMs !== void 0) {
      if (typeof fileWatching.debounceMs !== "number" || fileWatching.debounceMs < 0) {
        errors.push("fileWatching.debounceMs must be a non-negative number");
      } else if (fileWatching.debounceMs < 100) {
        warnings.push("fileWatching.debounceMs is very short (<100ms). This may cause excessive reindexing");
      }
    }
  }
  /**
   * Validate frameworks configuration
   */
  validateFrameworks(frameworks, errors, warnings) {
    if (!Array.isArray(frameworks)) {
      errors.push("frameworks must be an array");
      return;
    }
    frameworks.forEach((framework, index) => {
      if (!framework || typeof framework !== "object") {
        errors.push(`frameworks[${index}] must be an object`);
        return;
      }
      const fw = framework;
      if (!fw.name) {
        errors.push(`frameworks[${index}] missing required field: name`);
      }
      if (fw.path === void 0) {
        errors.push(`frameworks[${index}] missing required field: path`);
      } else if (typeof fw.path !== "string") {
        errors.push(`frameworks[${index}].path must be a string`);
      } else if (path7.isAbsolute(fw.path)) {
        errors.push(`frameworks[${index}].path must be relative, got: ${fw.path}`);
      }
      if (fw.enabled === void 0) {
        errors.push(`frameworks[${index}] missing required field: enabled`);
      } else if (typeof fw.enabled !== "boolean") {
        errors.push(`frameworks[${index}].enabled must be a boolean`);
      }
      if (!fw.config) {
        errors.push(`frameworks[${index}] missing required field: config`);
      } else {
        this.validateFrameworkConfig(fw.config, `frameworks[${index}].config`, errors, warnings);
      }
    });
  }
  /**
   * Validate framework-specific configuration
   */
  validateFrameworkConfig(config, prefix, errors, _warnings) {
    if (!config || typeof config !== "object") {
      errors.push(`${prefix} must be an object`);
      return;
    }
    if (!Array.isArray(config.include)) {
      errors.push(`${prefix}.include must be an array`);
    } else {
      config.include.forEach((pattern, i) => {
        if (typeof pattern !== "string") {
          errors.push(`${prefix}.include[${i}] must be a string`);
        }
      });
    }
    if (!Array.isArray(config.exclude)) {
      errors.push(`${prefix}.exclude must be an array`);
    } else {
      config.exclude.forEach((pattern, i) => {
        if (typeof pattern !== "string") {
          errors.push(`${prefix}.exclude[${i}] must be a string`);
        }
      });
    }
  }
};
var configService = new ConfigService();

// ../core/dist/indexer/manifest.js
import fs5 from "fs/promises";
import path8 from "path";

// ../core/dist/utils/version.js
var coreVersion = "0.1.0";
function getPackageVersion() {
  return coreVersion;
}

// ../core/dist/indexer/manifest.js
var MANIFEST_FILE = "manifest.json";
var ManifestManager = class {
  manifestPath;
  indexPath;
  /**
   * Promise-based lock to prevent race conditions during concurrent updates.
   * Ensures read-modify-write operations are atomic.
   */
  updateLock = Promise.resolve();
  /**
   * Creates a new ManifestManager
   * @param indexPath - Path to the index directory (same as VectorDB path)
   */
  constructor(indexPath) {
    this.indexPath = indexPath;
    this.manifestPath = path8.join(indexPath, MANIFEST_FILE);
  }
  /**
   * Loads the manifest from disk.
   * Returns null if:
   * - Manifest doesn't exist (first run)
   * - Manifest is corrupt
   * - Format version is incompatible (triggers full reindex)
   *
   * @returns Loaded manifest or null
   */
  async load() {
    try {
      const content = await fs5.readFile(this.manifestPath, "utf-8");
      const manifest = JSON.parse(content);
      if (manifest.formatVersion !== INDEX_FORMAT_VERSION) {
        console.error(`[Lien] Index format v${manifest.formatVersion} is incompatible with current v${INDEX_FORMAT_VERSION}`);
        console.error(`[Lien] Full reindex required after Lien upgrade`);
        await this.clear();
        return null;
      }
      return manifest;
    } catch (error2) {
      if (error2.code === "ENOENT") {
        return null;
      }
      console.error(`[Lien] Warning: Failed to load manifest: ${error2}`);
      return null;
    }
  }
  /**
   * Saves the manifest to disk.
   * Always saves with current format and package versions.
   *
   * @param manifest - Manifest to save
   */
  async save(manifest) {
    try {
      await fs5.mkdir(this.indexPath, { recursive: true });
      const manifestToSave = {
        ...manifest,
        formatVersion: INDEX_FORMAT_VERSION,
        lienVersion: getPackageVersion(),
        lastIndexed: Date.now()
      };
      const content = JSON.stringify(manifestToSave, null, 2);
      await fs5.writeFile(this.manifestPath, content, "utf-8");
    } catch (error2) {
      console.error(`[Lien] Warning: Failed to save manifest: ${error2}`);
    }
  }
  /**
   * Adds or updates a file entry in the manifest.
   * Protected by lock to prevent race conditions during concurrent updates.
   *
   * @param filepath - Path to the file
   * @param entry - File entry metadata
   */
  async updateFile(filepath, entry) {
    this.updateLock = this.updateLock.then(async () => {
      const manifest = await this.load() || this.createEmpty();
      manifest.files[filepath] = entry;
      await this.save(manifest);
    }).catch((error2) => {
      console.error(`[Lien] Failed to update manifest for ${filepath}: ${error2}`);
      return void 0;
    });
    await this.updateLock;
  }
  /**
   * Removes a file entry from the manifest.
   * Protected by lock to prevent race conditions during concurrent updates.
   *
   * Note: If the manifest doesn't exist, this is a no-op (not an error).
   * This can happen legitimately after clearing the index or on fresh installs.
   *
   * @param filepath - Path to the file to remove
   */
  async removeFile(filepath) {
    this.updateLock = this.updateLock.then(async () => {
      const manifest = await this.load();
      if (!manifest) {
        return;
      }
      delete manifest.files[filepath];
      await this.save(manifest);
    }).catch((error2) => {
      console.error(`[Lien] Failed to remove manifest entry for ${filepath}: ${error2}`);
      return void 0;
    });
    await this.updateLock;
  }
  /**
   * Updates multiple files at once (more efficient than individual updates).
   * Protected by lock to prevent race conditions during concurrent updates.
   *
   * @param entries - Array of file entries to update
   */
  async updateFiles(entries) {
    this.updateLock = this.updateLock.then(async () => {
      const manifest = await this.load() || this.createEmpty();
      for (const entry of entries) {
        manifest.files[entry.filepath] = entry;
      }
      await this.save(manifest);
    }).catch((error2) => {
      console.error(`[Lien] Failed to update manifest for ${entries.length} files: ${error2}`);
      return void 0;
    });
    await this.updateLock;
  }
  /**
   * Updates the git state in the manifest.
   * Protected by lock to prevent race conditions during concurrent updates.
   *
   * @param gitState - Current git state
   */
  async updateGitState(gitState) {
    this.updateLock = this.updateLock.then(async () => {
      const manifest = await this.load() || this.createEmpty();
      manifest.gitState = gitState;
      await this.save(manifest);
    }).catch((error2) => {
      console.error(`[Lien] Failed to update git state in manifest: ${error2}`);
      return void 0;
    });
    await this.updateLock;
  }
  /**
   * Gets the list of files currently in the manifest
   *
   * @returns Array of filepaths
   */
  async getIndexedFiles() {
    const manifest = await this.load();
    if (!manifest)
      return [];
    return Object.keys(manifest.files);
  }
  /**
   * Detects which files have changed based on mtime comparison
   *
   * @param currentFiles - Map of current files with their mtimes
   * @returns Array of filepaths that have changed
   */
  async getChangedFiles(currentFiles) {
    const manifest = await this.load();
    if (!manifest) {
      return Array.from(currentFiles.keys());
    }
    const changedFiles = [];
    for (const [filepath, mtime] of currentFiles) {
      const entry = manifest.files[filepath];
      if (!entry) {
        changedFiles.push(filepath);
      } else if (entry.lastModified < mtime) {
        changedFiles.push(filepath);
      }
    }
    return changedFiles;
  }
  /**
   * Gets files that are in the manifest but not in the current file list
   * (i.e., deleted files)
   *
   * @param currentFiles - Set of current file paths
   * @returns Array of deleted file paths
   */
  async getDeletedFiles(currentFiles) {
    const manifest = await this.load();
    if (!manifest)
      return [];
    const deletedFiles = [];
    for (const filepath of Object.keys(manifest.files)) {
      if (!currentFiles.has(filepath)) {
        deletedFiles.push(filepath);
      }
    }
    return deletedFiles;
  }
  /**
   * Clears the manifest file
   */
  async clear() {
    try {
      await fs5.unlink(this.manifestPath);
    } catch (error2) {
      if (error2.code !== "ENOENT") {
        console.error(`[Lien] Warning: Failed to clear manifest: ${error2}`);
      }
    }
  }
  /**
   * Creates an empty manifest with current version information
   *
   * @returns Empty manifest
   */
  createEmpty() {
    return {
      formatVersion: INDEX_FORMAT_VERSION,
      lienVersion: getPackageVersion(),
      lastIndexed: Date.now(),
      files: {}
    };
  }
};

// ../core/dist/git/utils.js
import { exec } from "child_process";
import { promisify } from "util";
import fs6 from "fs/promises";
import path9 from "path";
var execAsync = promisify(exec);
async function isGitRepo(rootDir) {
  try {
    const gitDir = path9.join(rootDir, ".git");
    await fs6.access(gitDir);
    return true;
  } catch {
    return false;
  }
}
async function getCurrentBranch(rootDir) {
  try {
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
      cwd: rootDir,
      timeout: 5e3
      // 5 second timeout
    });
    return stdout.trim();
  } catch (error2) {
    throw new Error(`Failed to get current branch: ${error2}`);
  }
}
async function getCurrentCommit(rootDir) {
  try {
    const { stdout } = await execAsync("git rev-parse HEAD", {
      cwd: rootDir,
      timeout: 5e3
    });
    return stdout.trim();
  } catch (error2) {
    throw new Error(`Failed to get current commit: ${error2}`);
  }
}
async function getChangedFiles(rootDir, fromRef, toRef) {
  try {
    const { stdout } = await execAsync(`git diff --name-only ${fromRef}...${toRef}`, {
      cwd: rootDir,
      timeout: 1e4
      // 10 second timeout for diffs
    });
    const files = stdout.trim().split("\n").filter(Boolean).map((file) => path9.join(rootDir, file));
    return files;
  } catch (error2) {
    throw new Error(`Failed to get changed files: ${error2}`);
  }
}
async function getChangedFilesBetweenCommits(rootDir, fromCommit, toCommit) {
  try {
    const { stdout } = await execAsync(`git diff --name-only ${fromCommit} ${toCommit}`, {
      cwd: rootDir,
      timeout: 1e4
    });
    const files = stdout.trim().split("\n").filter(Boolean).map((file) => path9.join(rootDir, file));
    return files;
  } catch (error2) {
    throw new Error(`Failed to get changed files between commits: ${error2}`);
  }
}
async function isGitAvailable() {
  try {
    await execAsync("git --version", { timeout: 3e3 });
    return true;
  } catch {
    return false;
  }
}

// ../core/dist/git/tracker.js
import fs7 from "fs/promises";
import path10 from "path";
var GitStateTracker = class {
  stateFile;
  rootDir;
  currentState = null;
  constructor(rootDir, indexPath) {
    this.rootDir = rootDir;
    this.stateFile = path10.join(indexPath, ".git-state.json");
  }
  /**
   * Loads the last known git state from disk.
   * Returns null if no state file exists (first run).
   */
  async loadState() {
    try {
      const content = await fs7.readFile(this.stateFile, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  /**
   * Saves the current git state to disk.
   */
  async saveState(state) {
    try {
      const content = JSON.stringify(state, null, 2);
      await fs7.writeFile(this.stateFile, content, "utf-8");
    } catch (error2) {
      console.error(`[Lien] Warning: Failed to save git state: ${error2}`);
    }
  }
  /**
   * Gets the current git state from the repository.
   *
   * @returns Current git state
   * @throws Error if git commands fail
   */
  async getCurrentGitState() {
    const branch = await getCurrentBranch(this.rootDir);
    const commit = await getCurrentCommit(this.rootDir);
    return {
      branch,
      commit,
      timestamp: Date.now()
    };
  }
  /**
   * Initializes the tracker by loading saved state and checking current state.
   * Should be called once when MCP server starts.
   *
   * @returns Array of changed files if state changed, null if no changes or first run
   */
  async initialize() {
    const isRepo = await isGitRepo(this.rootDir);
    if (!isRepo) {
      return null;
    }
    try {
      this.currentState = await this.getCurrentGitState();
      const previousState = await this.loadState();
      if (!previousState) {
        await this.saveState(this.currentState);
        return null;
      }
      const branchChanged = previousState.branch !== this.currentState.branch;
      const commitChanged = previousState.commit !== this.currentState.commit;
      if (!branchChanged && !commitChanged) {
        return null;
      }
      let changedFiles = [];
      if (branchChanged) {
        try {
          changedFiles = await getChangedFiles(this.rootDir, previousState.branch, this.currentState.branch);
        } catch (error2) {
          console.error(`[Lien] Branch diff failed, using commit diff: ${error2}`);
          changedFiles = await getChangedFilesBetweenCommits(this.rootDir, previousState.commit, this.currentState.commit);
        }
      } else if (commitChanged) {
        changedFiles = await getChangedFilesBetweenCommits(this.rootDir, previousState.commit, this.currentState.commit);
      }
      await this.saveState(this.currentState);
      return changedFiles;
    } catch (error2) {
      console.error(`[Lien] Failed to initialize git tracker: ${error2}`);
      return null;
    }
  }
  /**
   * Checks for git state changes since last check.
   * This is called periodically by the MCP server.
   *
   * @returns Array of changed files if state changed, null if no changes
   */
  async detectChanges() {
    const isRepo = await isGitRepo(this.rootDir);
    if (!isRepo) {
      return null;
    }
    try {
      const newState = await this.getCurrentGitState();
      if (!this.currentState) {
        this.currentState = newState;
        await this.saveState(newState);
        return null;
      }
      const branchChanged = this.currentState.branch !== newState.branch;
      const commitChanged = this.currentState.commit !== newState.commit;
      if (!branchChanged && !commitChanged) {
        return null;
      }
      let changedFiles = [];
      if (branchChanged) {
        try {
          changedFiles = await getChangedFiles(this.rootDir, this.currentState.branch, newState.branch);
        } catch (error2) {
          console.error(`[Lien] Branch diff failed, using commit diff: ${error2}`);
          changedFiles = await getChangedFilesBetweenCommits(this.rootDir, this.currentState.commit, newState.commit);
        }
      } else if (commitChanged) {
        changedFiles = await getChangedFilesBetweenCommits(this.rootDir, this.currentState.commit, newState.commit);
      }
      this.currentState = newState;
      await this.saveState(newState);
      return changedFiles;
    } catch (error2) {
      console.error(`[Lien] Failed to detect git changes: ${error2}`);
      return null;
    }
  }
  /**
   * Gets the current git state.
   * Useful for status display.
   */
  getState() {
    return this.currentState;
  }
  /**
   * Manually updates the saved state.
   * Useful after manual reindexing to sync state.
   */
  async updateState() {
    try {
      this.currentState = await this.getCurrentGitState();
      await this.saveState(this.currentState);
    } catch (error2) {
      console.error(`[Lien] Failed to update git state: ${error2}`);
    }
  }
};

// ../core/dist/indexer/change-detector.js
import fs9 from "fs/promises";
import path12 from "path";

// ../core/dist/indexer/incremental.js
import fs8 from "fs/promises";
import path11 from "path";

// ../core/dist/utils/result.js
function Ok(value) {
  return { ok: true, value };
}
function Err(error2) {
  return { ok: false, error: error2 };
}
function isOk(result) {
  return result.ok;
}

// ../core/dist/indexer/incremental.js
function normalizeToRelativePath(filepath, rootDir) {
  const root = (rootDir || process.cwd()).replace(/\\/g, "/").replace(/\/$/, "");
  const normalized = filepath.replace(/\\/g, "/");
  if (!path11.isAbsolute(filepath)) {
    return normalized;
  }
  if (normalized.startsWith(root + "/")) {
    return normalized.slice(root.length + 1);
  }
  if (normalized.startsWith(root)) {
    return normalized.slice(root.length);
  }
  return path11.relative(root, filepath).replace(/\\/g, "/");
}
async function processFileContent(filepath, content, embeddings, config, verbose) {
  const chunkSize = isModernConfig(config) ? config.core.chunkSize : isLegacyConfig(config) ? config.indexing.chunkSize : 75;
  const chunkOverlap = isModernConfig(config) ? config.core.chunkOverlap : isLegacyConfig(config) ? config.indexing.chunkOverlap : 10;
  const useAST = isModernConfig(config) ? config.chunking.useAST : true;
  const astFallback = isModernConfig(config) ? config.chunking.astFallback : "line-based";
  const chunks = chunkFile(filepath, content, {
    chunkSize,
    chunkOverlap,
    useAST,
    astFallback
  });
  if (chunks.length === 0) {
    if (verbose) {
      console.error(`[Lien] Empty file: ${filepath}`);
    }
    return null;
  }
  const texts = chunks.map((c) => c.content);
  const vectors = [];
  for (let j = 0; j < texts.length; j += EMBEDDING_MICRO_BATCH_SIZE) {
    const microBatch = texts.slice(j, Math.min(j + EMBEDDING_MICRO_BATCH_SIZE, texts.length));
    const microResults = await embeddings.embedBatch(microBatch);
    vectors.push(...microResults);
    if (texts.length > EMBEDDING_MICRO_BATCH_SIZE) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return {
    chunkCount: chunks.length,
    vectors,
    chunks,
    texts
  };
}
async function processSingleFileForIndexing(filepath, normalizedPath, embeddings, config, verbose) {
  try {
    const stats = await fs8.stat(filepath);
    const content = await fs8.readFile(filepath, "utf-8");
    const result = await processFileContent(normalizedPath, content, embeddings, config, verbose);
    return Ok({
      filepath: normalizedPath,
      // Store normalized path
      result,
      mtime: stats.mtimeMs
    });
  } catch (error2) {
    return Err(`Failed to process ${normalizedPath}: ${error2}`);
  }
}
async function indexMultipleFiles(filepaths, vectorDB, embeddings, config, options = {}) {
  const { verbose } = options;
  let processedCount = 0;
  const manifestEntries = [];
  for (const filepath of filepaths) {
    const normalizedPath = normalizeToRelativePath(filepath);
    const result = await processSingleFileForIndexing(filepath, normalizedPath, embeddings, config, verbose || false);
    if (isOk(result)) {
      const { filepath: storedPath, result: processResult, mtime } = result.value;
      if (processResult === null) {
        try {
          await vectorDB.deleteByFile(storedPath);
        } catch (error2) {
        }
        const manifest = new ManifestManager(vectorDB.dbPath);
        await manifest.updateFile(storedPath, {
          filepath: storedPath,
          lastModified: mtime,
          chunkCount: 0
        });
        processedCount++;
        continue;
      }
      try {
        await vectorDB.deleteByFile(storedPath);
      } catch (error2) {
      }
      await vectorDB.insertBatch(processResult.vectors, processResult.chunks.map((c) => c.metadata), processResult.texts);
      manifestEntries.push({
        filepath: storedPath,
        chunkCount: processResult.chunkCount,
        mtime
      });
      if (verbose) {
        console.error(`[Lien] \u2713 Updated ${storedPath} (${processResult.chunkCount} chunks)`);
      }
      processedCount++;
    } else {
      if (verbose) {
        console.error(`[Lien] ${result.error}`);
      }
      try {
        await vectorDB.deleteByFile(normalizedPath);
        const manifest = new ManifestManager(vectorDB.dbPath);
        await manifest.removeFile(normalizedPath);
      } catch (error2) {
        if (verbose) {
          console.error(`[Lien] Note: ${normalizedPath} not in index`);
        }
      }
      processedCount++;
    }
  }
  if (manifestEntries.length > 0) {
    const manifest = new ManifestManager(vectorDB.dbPath);
    await manifest.updateFiles(manifestEntries.map((entry) => ({
      filepath: entry.filepath,
      lastModified: entry.mtime,
      // Use actual file mtime for accurate change detection
      chunkCount: entry.chunkCount
    })));
  }
  return processedCount;
}

// ../core/dist/indexer/change-detector.js
async function hasGitStateChanged(rootDir, dbPath, savedGitState) {
  if (!savedGitState)
    return { changed: false };
  const gitAvailable = await isGitAvailable();
  const isRepo = await isGitRepo(rootDir);
  if (!gitAvailable || !isRepo)
    return { changed: false };
  const gitTracker = new GitStateTracker(rootDir, dbPath);
  await gitTracker.initialize();
  const currentState = gitTracker.getState();
  if (!currentState)
    return { changed: false };
  const changed = currentState.branch !== savedGitState.branch || currentState.commit !== savedGitState.commit;
  return { changed, currentState };
}
function categorizeChangedFiles(changedFilesPaths, currentFileSet, normalizedManifestFiles, allFiles) {
  const changedFilesSet = new Set(changedFilesPaths);
  const added = [];
  const modified = [];
  const deleted = [];
  for (const filepath of changedFilesPaths) {
    if (currentFileSet.has(filepath)) {
      if (normalizedManifestFiles.has(filepath)) {
        modified.push(filepath);
      } else {
        added.push(filepath);
      }
    }
  }
  for (const filepath of allFiles) {
    if (!normalizedManifestFiles.has(filepath) && !changedFilesSet.has(filepath)) {
      added.push(filepath);
    }
  }
  for (const normalizedPath of normalizedManifestFiles) {
    if (!currentFileSet.has(normalizedPath)) {
      deleted.push(normalizedPath);
    }
  }
  return { added, modified, deleted };
}
function normalizeManifestPaths(manifestFiles, rootDir) {
  const normalized = /* @__PURE__ */ new Set();
  for (const filepath of Object.keys(manifestFiles)) {
    normalized.add(normalizeToRelativePath(filepath, rootDir));
  }
  return normalized;
}
async function detectGitBasedChanges(rootDir, savedManifest, currentCommit, config) {
  const changedFilesAbsolute = await getChangedFiles(rootDir, savedManifest.gitState.commit, currentCommit);
  const changedFilesPaths = changedFilesAbsolute.map((fp) => normalizeToRelativePath(fp, rootDir));
  const allFiles = await getAllFiles(rootDir, config);
  const currentFileSet = new Set(allFiles);
  const normalizedManifestFiles = normalizeManifestPaths(savedManifest.files, rootDir);
  const { added, modified, deleted } = categorizeChangedFiles(changedFilesPaths, currentFileSet, normalizedManifestFiles, allFiles);
  return { added, modified, deleted, reason: "git-state-changed" };
}
async function fallbackToFullReindex(rootDir, savedManifest, config) {
  const allFiles = await getAllFiles(rootDir, config);
  const currentFileSet = new Set(allFiles);
  const deleted = [];
  for (const filepath of Object.keys(savedManifest.files)) {
    const normalizedPath = normalizeToRelativePath(filepath, rootDir);
    if (!currentFileSet.has(normalizedPath)) {
      deleted.push(normalizedPath);
    }
  }
  return { added: allFiles, modified: [], deleted, reason: "git-state-changed" };
}
async function detectChanges(rootDir, vectorDB, config) {
  const manifest = new ManifestManager(vectorDB.dbPath);
  const savedManifest = await manifest.load();
  if (!savedManifest) {
    const allFiles = await getAllFiles(rootDir, config);
    return { added: allFiles, modified: [], deleted: [], reason: "full" };
  }
  const gitCheck = await hasGitStateChanged(rootDir, vectorDB.dbPath, savedManifest.gitState);
  if (gitCheck.changed && gitCheck.currentState) {
    try {
      return await detectGitBasedChanges(rootDir, savedManifest, gitCheck.currentState.commit, config);
    } catch (error2) {
      console.warn(`[Lien] Git diff failed, falling back to full reindex: ${error2}`);
      return await fallbackToFullReindex(rootDir, savedManifest, config);
    }
  }
  return await mtimeBasedDetection(rootDir, savedManifest, config);
}
async function getAllFiles(rootDir, config) {
  let files;
  if (isModernConfig(config) && config.frameworks.length > 0) {
    files = await scanCodebaseWithFrameworks(rootDir, config);
  } else if (isLegacyConfig(config)) {
    files = await scanCodebase({
      rootDir,
      includePatterns: config.indexing.include,
      excludePatterns: config.indexing.exclude
    });
  } else {
    files = await scanCodebase({
      rootDir,
      includePatterns: [],
      excludePatterns: []
    });
  }
  return files.map((fp) => normalizeToRelativePath(fp, rootDir));
}
async function mtimeBasedDetection(rootDir, savedManifest, config) {
  const added = [];
  const modified = [];
  const deleted = [];
  const currentFiles = await getAllFiles(rootDir, config);
  const currentFileSet = new Set(currentFiles);
  const normalizedManifestFiles = /* @__PURE__ */ new Map();
  for (const [filepath, entry] of Object.entries(savedManifest.files)) {
    const normalizedPath = normalizeToRelativePath(filepath, rootDir);
    normalizedManifestFiles.set(normalizedPath, entry);
  }
  const fileStats = /* @__PURE__ */ new Map();
  for (const filepath of currentFiles) {
    try {
      const absolutePath = path12.isAbsolute(filepath) ? filepath : path12.join(rootDir, filepath);
      const stats = await fs9.stat(absolutePath);
      fileStats.set(filepath, stats.mtimeMs);
    } catch {
      continue;
    }
  }
  for (const [filepath, mtime] of fileStats) {
    const entry = normalizedManifestFiles.get(filepath);
    if (!entry) {
      added.push(filepath);
    } else if (entry.lastModified < mtime) {
      modified.push(filepath);
    }
  }
  for (const normalizedPath of normalizedManifestFiles.keys()) {
    if (!currentFileSet.has(normalizedPath)) {
      deleted.push(normalizedPath);
    }
  }
  return {
    added,
    modified,
    deleted,
    reason: "mtime"
  };
}

// ../core/dist/indexer/chunk-batch-processor.js
async function processEmbeddingMicroBatches(texts, embeddings) {
  const results = [];
  for (let j = 0; j < texts.length; j += EMBEDDING_MICRO_BATCH_SIZE) {
    const microBatch = texts.slice(j, Math.min(j + EMBEDDING_MICRO_BATCH_SIZE, texts.length));
    const microResults = await embeddings.embedBatch(microBatch);
    results.push(...microResults);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return results;
}
var ChunkBatchProcessor = class {
  vectorDB;
  embeddings;
  config;
  progressTracker;
  accumulator = [];
  indexedFiles = [];
  processedChunkCount = 0;
  // Mutex state for concurrent access protection
  addChunksLock = null;
  processingQueue = null;
  constructor(vectorDB, embeddings, config, progressTracker) {
    this.vectorDB = vectorDB;
    this.embeddings = embeddings;
    this.config = config;
    this.progressTracker = progressTracker;
  }
  /**
   * Add chunks from a processed file.
   * Thread-safe: uses mutex to prevent race conditions with concurrent calls.
   *
   * @param chunks - Code chunks to add
   * @param filepath - Source file path (for manifest)
   * @param mtime - File modification time in ms (for change detection)
   */
  async addChunks(chunks, filepath, mtime) {
    if (chunks.length === 0) {
      return;
    }
    if (this.addChunksLock) {
      await this.addChunksLock;
    }
    let releaseLock;
    this.addChunksLock = new Promise((resolve) => {
      releaseLock = resolve;
    });
    try {
      for (const chunk of chunks) {
        this.accumulator.push({
          chunk,
          content: chunk.content
        });
      }
      this.indexedFiles.push({
        filepath,
        chunkCount: chunks.length,
        mtime
      });
      if (this.accumulator.length >= this.config.batchThreshold) {
        await this.triggerProcessing();
      }
    } finally {
      releaseLock();
      this.addChunksLock = null;
    }
  }
  /**
   * Flush any remaining accumulated chunks.
   * Call this after all files have been processed.
   */
  async flush() {
    this.progressTracker.setMessage?.("Processing final chunks...");
    await this.triggerProcessing();
  }
  /**
   * Get processing results.
   */
  getResults() {
    return {
      processedChunks: this.processedChunkCount,
      indexedFiles: [...this.indexedFiles]
    };
  }
  /**
   * Trigger batch processing. Uses queue-based synchronization
   * to prevent TOCTOU race conditions.
   */
  async triggerProcessing() {
    if (this.processingQueue) {
      this.processingQueue = this.processingQueue.then(() => this.doProcess());
    } else {
      this.processingQueue = this.doProcess();
    }
    return this.processingQueue;
  }
  /**
   * The actual batch processing logic.
   * Processes accumulated chunks through embedding → vectordb pipeline.
   */
  async doProcess() {
    if (this.accumulator.length === 0) {
      return;
    }
    const currentPromise = this.processingQueue;
    try {
      const toProcess = this.accumulator.splice(0, this.accumulator.length);
      for (let i = 0; i < toProcess.length; i += this.config.embeddingBatchSize) {
        const batch = toProcess.slice(i, Math.min(i + this.config.embeddingBatchSize, toProcess.length));
        const texts = batch.map((item) => item.content);
        this.progressTracker.setMessage?.("Generating embeddings...");
        const embeddingVectors = await processEmbeddingMicroBatches(texts, this.embeddings);
        this.processedChunkCount += batch.length;
        this.progressTracker.setMessage?.(`Inserting ${batch.length} chunks...`);
        await this.vectorDB.insertBatch(embeddingVectors, batch.map((item) => item.chunk.metadata), texts);
        await new Promise((resolve) => setImmediate(resolve));
      }
      this.progressTracker.setMessage?.("Processing files...");
    } finally {
      if (this.processingQueue === currentPromise) {
        this.processingQueue = null;
      }
    }
  }
};

// ../core/dist/indexer/index.js
function getIndexingConfig(config) {
  if (isModernConfig(config)) {
    return {
      concurrency: config.core.concurrency,
      embeddingBatchSize: config.core.embeddingBatchSize,
      chunkSize: config.core.chunkSize,
      chunkOverlap: config.core.chunkOverlap,
      useAST: config.chunking.useAST,
      astFallback: config.chunking.astFallback
    };
  }
  return {
    concurrency: 4,
    embeddingBatchSize: 50,
    chunkSize: 75,
    chunkOverlap: 10,
    useAST: true,
    astFallback: "line-based"
  };
}
async function scanFilesToIndex(rootDir, config) {
  if (isModernConfig(config) && config.frameworks.length > 0) {
    return scanCodebaseWithFrameworks(rootDir, config);
  }
  if (isLegacyConfig(config)) {
    return scanCodebase({
      rootDir,
      includePatterns: config.indexing.include,
      excludePatterns: config.indexing.exclude
    });
  }
  return scanCodebase({ rootDir, includePatterns: [], excludePatterns: [] });
}
async function updateGitState(rootDir, vectorDB, manifest) {
  const gitAvailable = await isGitAvailable();
  const isRepo = await isGitRepo(rootDir);
  if (!gitAvailable || !isRepo) {
    return;
  }
  const gitTracker = new GitStateTracker(rootDir, vectorDB.dbPath);
  await gitTracker.initialize();
  const gitState = gitTracker.getState();
  if (gitState) {
    await manifest.updateGitState(gitState);
  }
}
async function handleDeletions(deletedFiles, vectorDB, manifest) {
  if (deletedFiles.length === 0) {
    return 0;
  }
  let removedCount = 0;
  for (const filepath of deletedFiles) {
    try {
      await vectorDB.deleteByFile(filepath);
      await manifest.removeFile(filepath);
      removedCount++;
    } catch {
    }
  }
  return removedCount;
}
async function handleUpdates(addedFiles, modifiedFiles, vectorDB, embeddings, config, options) {
  const filesToIndex = [...addedFiles, ...modifiedFiles];
  if (filesToIndex.length === 0) {
    return 0;
  }
  const count = await indexMultipleFiles(filesToIndex, vectorDB, embeddings, config, { verbose: options.verbose });
  await writeVersionFile(vectorDB.dbPath);
  return count;
}
async function tryIncrementalIndex(rootDir, vectorDB, config, options, startTime) {
  const manifest = new ManifestManager(vectorDB.dbPath);
  const savedManifest = await manifest.load();
  if (!savedManifest) {
    return null;
  }
  const changes = await detectChanges(rootDir, vectorDB, config);
  if (changes.reason === "full") {
    return null;
  }
  const totalChanges = changes.added.length + changes.modified.length;
  const totalDeleted = changes.deleted.length;
  if (totalChanges === 0 && totalDeleted === 0) {
    options.onProgress?.({
      phase: "complete",
      message: "Index is up to date - no changes detected",
      filesTotal: 0,
      filesProcessed: 0
    });
    return {
      success: true,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: true
    };
  }
  options.onProgress?.({
    phase: "embedding",
    message: `Detected ${totalChanges} files to index, ${totalDeleted} to remove`
  });
  const embeddings = options.embeddings ?? new LocalEmbeddings();
  if (!options.embeddings) {
    await embeddings.initialize();
  }
  await handleDeletions(changes.deleted, vectorDB, manifest);
  const indexedCount = await handleUpdates(changes.added, changes.modified, vectorDB, embeddings, config, options);
  await updateGitState(rootDir, vectorDB, manifest);
  options.onProgress?.({
    phase: "complete",
    message: `Updated ${indexedCount} file${indexedCount !== 1 ? "s" : ""}, removed ${totalDeleted}`,
    filesTotal: totalChanges + totalDeleted,
    filesProcessed: indexedCount + totalDeleted
  });
  return {
    success: true,
    filesIndexed: indexedCount,
    chunksCreated: 0,
    // Not tracked in incremental mode
    durationMs: Date.now() - startTime,
    incremental: true
  };
}
async function processFileForIndexing(file, batchProcessor, indexConfig, progressTracker, _verbose) {
  try {
    const stats = await fs10.stat(file);
    const content = await fs10.readFile(file, "utf-8");
    const chunks = chunkFile(file, content, {
      chunkSize: indexConfig.chunkSize,
      chunkOverlap: indexConfig.chunkOverlap,
      useAST: indexConfig.useAST,
      astFallback: indexConfig.astFallback
    });
    if (chunks.length === 0) {
      progressTracker.incrementFiles();
      return false;
    }
    await batchProcessor.addChunks(chunks, file, stats.mtimeMs);
    progressTracker.incrementFiles();
    return true;
  } catch {
    progressTracker.incrementFiles();
    return false;
  }
}
async function performFullIndex(rootDir, vectorDB, config, options, startTime) {
  options.onProgress?.({ phase: "initializing", message: "Clearing existing index..." });
  await vectorDB.clear();
  options.onProgress?.({ phase: "scanning", message: "Scanning codebase..." });
  const files = await scanFilesToIndex(rootDir, config);
  if (files.length === 0) {
    return {
      success: false,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: false,
      error: "No files found to index"
    };
  }
  options.onProgress?.({
    phase: "embedding",
    message: "Loading embedding model...",
    filesTotal: files.length
  });
  const embeddings = options.embeddings ?? new LocalEmbeddings();
  if (!options.embeddings) {
    await embeddings.initialize();
  }
  const indexConfig = getIndexingConfig(config);
  const processedCount = { value: 0 };
  const progressTracker = {
    incrementFiles: () => {
      processedCount.value++;
      options.onProgress?.({
        phase: "indexing",
        message: `Processing files...`,
        filesTotal: files.length,
        filesProcessed: processedCount.value
      });
    },
    incrementChunks: () => {
    },
    getProcessedCount: () => processedCount.value,
    start: () => {
    },
    stop: () => {
    }
  };
  const batchProcessor = new ChunkBatchProcessor(vectorDB, embeddings, {
    batchThreshold: 100,
    embeddingBatchSize: indexConfig.embeddingBatchSize
  }, progressTracker);
  options.onProgress?.({
    phase: "indexing",
    message: `Processing ${files.length} files...`,
    filesTotal: files.length,
    filesProcessed: 0
  });
  try {
    const limit = pLimit(indexConfig.concurrency);
    const filePromises = files.map((file) => limit(() => processFileForIndexing(file, batchProcessor, indexConfig, progressTracker, options.verbose ?? false)));
    await Promise.all(filePromises);
    await batchProcessor.flush();
  } catch (error2) {
    return {
      success: false,
      filesIndexed: processedCount.value,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: false,
      error: error2 instanceof Error ? error2.message : String(error2)
    };
  }
  options.onProgress?.({ phase: "saving", message: "Saving index manifest..." });
  const { processedChunks, indexedFiles } = batchProcessor.getResults();
  const manifest = new ManifestManager(vectorDB.dbPath);
  await manifest.updateFiles(indexedFiles.map((entry) => ({
    filepath: entry.filepath,
    lastModified: entry.mtime,
    chunkCount: entry.chunkCount
  })));
  await updateGitState(rootDir, vectorDB, manifest);
  await writeVersionFile(vectorDB.dbPath);
  options.onProgress?.({
    phase: "complete",
    message: "Indexing complete",
    filesTotal: files.length,
    filesProcessed: processedCount.value,
    chunksProcessed: processedChunks
  });
  return {
    success: true,
    filesIndexed: processedCount.value,
    chunksCreated: processedChunks,
    durationMs: Date.now() - startTime,
    incremental: false
  };
}
async function indexCodebase(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const startTime = Date.now();
  try {
    options.onProgress?.({ phase: "initializing", message: "Loading configuration..." });
    const config = options.config ?? await configService.load(rootDir);
    options.onProgress?.({ phase: "initializing", message: "Initializing vector database..." });
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();
    if (!options.force) {
      const incrementalResult = await tryIncrementalIndex(rootDir, vectorDB, config, options, startTime);
      if (incrementalResult) {
        return incrementalResult;
      }
    }
    return await performFullIndex(rootDir, vectorDB, config, options, startTime);
  } catch (error2) {
    return {
      success: false,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: false,
      error: error2 instanceof Error ? error2.message : String(error2)
    };
  }
}

// ../core/dist/insights/types.js
var RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };

// ../core/dist/utils/path-matching.js
function normalizePath(path13, workspaceRoot) {
  let normalized = path13.replace(/['"]/g, "").trim().replace(/\\/g, "/");
  normalized = normalized.replace(/\.(ts|tsx|js|jsx)$/, "");
  if (normalized.startsWith(workspaceRoot + "/")) {
    normalized = normalized.substring(workspaceRoot.length + 1);
  }
  return normalized;
}
function matchesAtBoundary(str, pattern) {
  const index = str.indexOf(pattern);
  if (index === -1)
    return false;
  const charBefore = index > 0 ? str[index - 1] : "/";
  if (charBefore !== "/" && index !== 0)
    return false;
  const endIndex = index + pattern.length;
  if (endIndex === str.length)
    return true;
  const charAfter = str[endIndex];
  return charAfter === "/";
}
function matchesFile(normalizedImport, normalizedTarget) {
  if (normalizedImport === normalizedTarget)
    return true;
  if (matchesAtBoundary(normalizedImport, normalizedTarget)) {
    return true;
  }
  if (matchesAtBoundary(normalizedTarget, normalizedImport)) {
    return true;
  }
  const cleanedImport = normalizedImport.replace(/^(\.\.?\/)+/, "");
  if (matchesAtBoundary(cleanedImport, normalizedTarget) || matchesAtBoundary(normalizedTarget, cleanedImport)) {
    return true;
  }
  return false;
}
function getCanonicalPath(filepath, workspaceRoot) {
  let canonical = filepath.replace(/\\/g, "/");
  if (canonical.startsWith(workspaceRoot + "/")) {
    canonical = canonical.substring(workspaceRoot.length + 1);
  }
  return canonical;
}
function isTestFile2(filepath) {
  return /\.(test|spec)\.[^/]+$/.test(filepath) || /(^|[/\\])(test|tests|__tests__)[/\\]/.test(filepath);
}

// ../core/dist/indexer/dependency-analyzer.js
var DEPENDENT_COUNT_THRESHOLDS = {
  LOW: 5,
  // Few dependents, safe to change
  MEDIUM: 15,
  // Moderate impact, review dependents
  HIGH: 30
  // High impact, careful planning needed
};
var COMPLEXITY_THRESHOLDS = {
  HIGH_COMPLEXITY_DEPENDENT: 10,
  // Individual file is complex
  CRITICAL_AVG: 15,
  // Average complexity indicates systemic complexity
  CRITICAL_MAX: 25,
  // Peak complexity indicates hotspot
  HIGH_AVG: 10,
  // Moderately complex on average
  HIGH_MAX: 20,
  // Some complex functions exist
  MEDIUM_AVG: 6,
  // Slightly above simple code
  MEDIUM_MAX: 15
  // Occasional branching
};
function createPathNormalizer(workspaceRoot) {
  const cache = /* @__PURE__ */ new Map();
  return (path13) => {
    const cached = cache.get(path13);
    if (cached !== void 0)
      return cached;
    const normalized = normalizePath(path13, workspaceRoot);
    cache.set(path13, normalized);
    return normalized;
  };
}
function buildImportIndex(chunks, normalizePathCached) {
  const importIndex = /* @__PURE__ */ new Map();
  for (const chunk of chunks) {
    const imports = chunk.metadata.imports || [];
    for (const imp of imports) {
      const normalizedImport = normalizePathCached(imp);
      let chunkList = importIndex.get(normalizedImport);
      if (!chunkList) {
        chunkList = [];
        importIndex.set(normalizedImport, chunkList);
      }
      chunkList.push(chunk);
    }
  }
  return importIndex;
}
function findDependentChunks(normalizedTarget, importIndex) {
  const dependentChunks = [];
  const seenChunkIds = /* @__PURE__ */ new Set();
  const addChunk = (chunk) => {
    const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
    if (!seenChunkIds.has(chunkId)) {
      dependentChunks.push(chunk);
      seenChunkIds.add(chunkId);
    }
  };
  const directMatches = importIndex.get(normalizedTarget);
  if (directMatches) {
    for (const chunk of directMatches) {
      addChunk(chunk);
    }
  }
  for (const [normalizedImport, chunks] of importIndex.entries()) {
    if (normalizedImport !== normalizedTarget && matchesFile(normalizedImport, normalizedTarget)) {
      for (const chunk of chunks) {
        addChunk(chunk);
      }
    }
  }
  return dependentChunks;
}
function groupChunksByFile(chunks, workspaceRoot) {
  const chunksByFile = /* @__PURE__ */ new Map();
  for (const chunk of chunks) {
    const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
    let existing = chunksByFile.get(canonical);
    if (!existing) {
      existing = [];
      chunksByFile.set(canonical, existing);
    }
    existing.push(chunk);
  }
  return chunksByFile;
}
function calculateFileComplexities(chunksByFile) {
  const fileComplexities = [];
  for (const [filepath, chunks] of chunksByFile.entries()) {
    const complexities = chunks.map((c) => c.metadata.complexity).filter((c) => typeof c === "number" && c > 0);
    if (complexities.length > 0) {
      const sum = complexities.reduce((a, b) => a + b, 0);
      const avg = sum / complexities.length;
      const max = Math.max(...complexities);
      fileComplexities.push({
        filepath,
        avgComplexity: Math.round(avg * 10) / 10,
        maxComplexity: max,
        complexityScore: sum,
        chunksWithComplexity: complexities.length
      });
    }
  }
  return fileComplexities;
}
function calculateOverallComplexityMetrics(fileComplexities) {
  if (fileComplexities.length === 0) {
    return void 0;
  }
  const allAvgs = fileComplexities.map((f) => f.avgComplexity);
  const allMaxes = fileComplexities.map((f) => f.maxComplexity);
  const totalAvg = allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length;
  const globalMax = Math.max(...allMaxes);
  const highComplexityDependents = fileComplexities.filter((f) => f.maxComplexity > COMPLEXITY_THRESHOLDS.HIGH_COMPLEXITY_DEPENDENT).sort((a, b) => b.maxComplexity - a.maxComplexity).slice(0, 5).map((f) => ({
    filepath: f.filepath,
    maxComplexity: f.maxComplexity,
    avgComplexity: f.avgComplexity
  }));
  const complexityRiskBoost = calculateComplexityRiskBoost(totalAvg, globalMax);
  return {
    averageComplexity: Math.round(totalAvg * 10) / 10,
    maxComplexity: globalMax,
    filesWithComplexityData: fileComplexities.length,
    highComplexityDependents,
    complexityRiskBoost
  };
}
function calculateComplexityRiskBoost(avgComplexity, maxComplexity) {
  if (avgComplexity > COMPLEXITY_THRESHOLDS.CRITICAL_AVG || maxComplexity > COMPLEXITY_THRESHOLDS.CRITICAL_MAX) {
    return "critical";
  }
  if (avgComplexity > COMPLEXITY_THRESHOLDS.HIGH_AVG || maxComplexity > COMPLEXITY_THRESHOLDS.HIGH_MAX) {
    return "high";
  }
  if (avgComplexity > COMPLEXITY_THRESHOLDS.MEDIUM_AVG || maxComplexity > COMPLEXITY_THRESHOLDS.MEDIUM_MAX) {
    return "medium";
  }
  return "low";
}
function calculateRiskLevelFromCount(count) {
  if (count <= DEPENDENT_COUNT_THRESHOLDS.LOW) {
    return "low";
  }
  if (count <= DEPENDENT_COUNT_THRESHOLDS.MEDIUM) {
    return "medium";
  }
  if (count <= DEPENDENT_COUNT_THRESHOLDS.HIGH) {
    return "high";
  }
  return "critical";
}
function analyzeDependencies(targetFilepath, allChunks, workspaceRoot) {
  const normalizePathCached = createPathNormalizer(workspaceRoot);
  const importIndex = buildImportIndex(allChunks, normalizePathCached);
  const normalizedTarget = normalizePathCached(targetFilepath);
  const dependentChunks = findDependentChunks(normalizedTarget, importIndex);
  const chunksByFile = groupChunksByFile(dependentChunks, workspaceRoot);
  const fileComplexities = calculateFileComplexities(chunksByFile);
  const complexityMetrics = calculateOverallComplexityMetrics(fileComplexities);
  const dependents = Array.from(chunksByFile.keys()).map((filepath) => ({
    filepath,
    isTestFile: isTestFile2(filepath)
  }));
  let riskLevel = calculateRiskLevelFromCount(dependents.length);
  if (complexityMetrics?.complexityRiskBoost) {
    if (RISK_ORDER[complexityMetrics.complexityRiskBoost] > RISK_ORDER[riskLevel]) {
      riskLevel = complexityMetrics.complexityRiskBoost;
    }
  }
  return {
    dependents,
    dependentCount: dependents.length,
    riskLevel,
    complexityMetrics
  };
}

// ../core/dist/insights/complexity-analyzer.js
var SEVERITY = { warning: 1, error: 2 };
var ComplexityAnalyzer = class {
  vectorDB;
  config;
  constructor(vectorDB, config) {
    this.vectorDB = vectorDB;
    this.config = config;
  }
  /**
   * Analyze complexity of codebase or specific files
   * @param files - Optional list of specific files to analyze
   * @returns Complexity report with violations and summary
   */
  async analyze(files) {
    const allChunks = await this.vectorDB.scanAll();
    const chunks = files ? allChunks.filter((c) => this.matchesAnyFile(c.metadata.file, files)) : allChunks;
    const violations = this.findViolations(chunks);
    const report = this.buildReport(violations, chunks);
    this.enrichWithDependencies(report, allChunks);
    return report;
  }
  /**
   * Normalize a file path to a consistent relative format
   * Converts absolute paths to relative paths from workspace root
   */
  normalizeFilePath(filepath) {
    const workspaceRoot = process.cwd();
    const normalized = filepath.replace(/\\/g, "/");
    const normalizedRoot = workspaceRoot.replace(/\\/g, "/");
    if (normalized.startsWith(normalizedRoot + "/")) {
      return normalized.slice(normalizedRoot.length + 1);
    }
    if (normalized.startsWith(normalizedRoot)) {
      return normalized.slice(normalizedRoot.length);
    }
    return normalized;
  }
  /**
   * Check if a chunk's file matches any of the target files
   * Uses exact match or suffix matching to avoid unintended matches
   */
  matchesAnyFile(chunkFile2, targetFiles) {
    const normalizedChunkFile = chunkFile2.replace(/\\/g, "/");
    return targetFiles.some((target) => {
      const normalizedTarget = target.replace(/\\/g, "/");
      return normalizedChunkFile === normalizedTarget || normalizedChunkFile.endsWith("/" + normalizedTarget);
    });
  }
  /**
   * Create a violation if complexity exceeds threshold
   */
  createViolation(metadata, complexity, baseThreshold, metricType) {
    const warningThreshold = baseThreshold * SEVERITY.warning;
    const errorThreshold = baseThreshold * SEVERITY.error;
    if (complexity < warningThreshold)
      return null;
    const violationSeverity = complexity >= errorThreshold ? "error" : "warning";
    const effectiveThreshold = violationSeverity === "error" ? errorThreshold : warningThreshold;
    const message = metricType === "cyclomatic" ? `Needs ~${complexity} test cases for full coverage (threshold: ${Math.round(effectiveThreshold)})` : `Mental load ${complexity} exceeds threshold ${Math.round(effectiveThreshold)} (hard to follow)`;
    return {
      filepath: metadata.file,
      startLine: metadata.startLine,
      endLine: metadata.endLine,
      symbolName: metadata.symbolName || "unknown",
      symbolType: metadata.symbolType,
      language: metadata.language,
      complexity,
      threshold: Math.round(effectiveThreshold),
      severity: violationSeverity,
      message,
      metricType
    };
  }
  /**
   * Deduplicate and filter chunks to only function/method types.
   * Handles potential index duplicates by tracking file+line ranges.
   */
  getUniqueFunctionChunks(chunks) {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const { metadata } of chunks) {
      if (metadata.symbolType !== "function" && metadata.symbolType !== "method")
        continue;
      const key = `${metadata.file}:${metadata.startLine}-${metadata.endLine}`;
      if (seen.has(key))
        continue;
      seen.add(key);
      result.push(metadata);
    }
    return result;
  }
  /**
   * Convert Halstead effort to time in minutes.
   * Formula: Time (seconds) = Effort / 18 (Stroud number for mental discrimination)
   *          Time (minutes) = Effort / (18 * 60) = Effort / 1080
   */
  effortToMinutes(effort) {
    return effort / 1080;
  }
  /**
   * Format minutes as human-readable time (e.g., "2h 30m" or "45m")
   */
  formatTime(minutes) {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${Math.round(minutes)}m`;
  }
  /**
   * Create a Halstead violation if metrics exceed thresholds
   */
  createHalsteadViolation(metadata, metricValue, threshold, metricType) {
    const warningThreshold = threshold * SEVERITY.warning;
    const errorThreshold = threshold * SEVERITY.error;
    if (metricValue < warningThreshold)
      return null;
    const violationSeverity = metricValue >= errorThreshold ? "error" : "warning";
    const effectiveThreshold = violationSeverity === "error" ? errorThreshold : warningThreshold;
    let message;
    if (metricType === "halstead_effort") {
      const timeMinutes = this.effortToMinutes(metricValue);
      const thresholdMinutes = this.effortToMinutes(effectiveThreshold);
      message = `Time to understand ~${this.formatTime(timeMinutes)} exceeds threshold ${this.formatTime(thresholdMinutes)}`;
    } else {
      message = `Estimated bugs ${metricValue.toFixed(2)} exceeds threshold ${effectiveThreshold.toFixed(1)}`;
    }
    const halsteadDetails = {
      volume: metadata.halsteadVolume || 0,
      difficulty: metadata.halsteadDifficulty || 0,
      effort: metadata.halsteadEffort || 0,
      bugs: metadata.halsteadBugs || 0
    };
    let complexity;
    let displayThreshold;
    if (metricType === "halstead_effort") {
      complexity = Math.round(this.effortToMinutes(metricValue));
      displayThreshold = Math.round(this.effortToMinutes(effectiveThreshold));
    } else {
      complexity = metricValue;
      displayThreshold = effectiveThreshold;
    }
    return {
      filepath: metadata.file,
      startLine: metadata.startLine,
      endLine: metadata.endLine,
      symbolName: metadata.symbolName || "unknown",
      symbolType: metadata.symbolType,
      language: metadata.language,
      complexity,
      threshold: displayThreshold,
      severity: violationSeverity,
      message,
      metricType,
      halsteadDetails
    };
  }
  /**
   * Check complexity metrics and create violations for a single chunk.
   */
  checkChunkComplexity(metadata, thresholds) {
    const violations = [];
    if (metadata.complexity) {
      const v = this.createViolation(metadata, metadata.complexity, thresholds.testPaths, "cyclomatic");
      if (v)
        violations.push(v);
    }
    if (metadata.cognitiveComplexity) {
      const v = this.createViolation(metadata, metadata.cognitiveComplexity, thresholds.mentalLoad, "cognitive");
      if (v)
        violations.push(v);
    }
    if (thresholds.halsteadEffort && metadata.halsteadEffort) {
      const v = this.createHalsteadViolation(metadata, metadata.halsteadEffort, thresholds.halsteadEffort, "halstead_effort");
      if (v)
        violations.push(v);
    }
    if (thresholds.estimatedBugs && metadata.halsteadBugs) {
      const v = this.createHalsteadViolation(metadata, metadata.halsteadBugs, thresholds.estimatedBugs, "halstead_bugs");
      if (v)
        violations.push(v);
    }
    return violations;
  }
  /**
   * Convert time in minutes to Halstead effort.
   * This is the inverse of effortToMinutes().
   * Formula: Time (seconds) = Effort / 18 (Stroud number)
   *          So: Effort = Time (minutes) * 60 * 18 = Time * 1080
   */
  minutesToEffort(minutes) {
    return minutes * 1080;
  }
  /**
   * Find all complexity violations based on thresholds.
   * Checks cyclomatic, cognitive, and Halstead complexity.
   */
  findViolations(chunks) {
    const configThresholds = this.config.complexity?.thresholds;
    const halsteadEffort = configThresholds?.timeToUnderstandMinutes ? this.minutesToEffort(configThresholds.timeToUnderstandMinutes) : this.minutesToEffort(60);
    const thresholds = {
      testPaths: configThresholds?.testPaths ?? 15,
      mentalLoad: configThresholds?.mentalLoad ?? 15,
      halsteadEffort,
      // Converted from minutes to effort internally (see above)
      estimatedBugs: configThresholds?.estimatedBugs ?? 1.5
      // Direct decimal value (no conversion needed)
    };
    const functionChunks = this.getUniqueFunctionChunks(chunks);
    return functionChunks.flatMap((metadata) => this.checkChunkComplexity(metadata, thresholds));
  }
  /**
   * Build the final report with summary and per-file data
   */
  buildReport(violations, allChunks) {
    const fileViolationsMap = /* @__PURE__ */ new Map();
    for (const violation of violations) {
      const normalizedPath = this.normalizeFilePath(violation.filepath);
      violation.filepath = normalizedPath;
      const existing = fileViolationsMap.get(normalizedPath) || [];
      existing.push(violation);
      fileViolationsMap.set(normalizedPath, existing);
    }
    const analyzedFiles = new Set(allChunks.map((c) => this.normalizeFilePath(c.metadata.file)));
    const files = {};
    for (const filepath of analyzedFiles) {
      const fileViolations = fileViolationsMap.get(filepath) || [];
      files[filepath] = {
        violations: fileViolations,
        dependents: [],
        // Will be enriched later if needed
        testAssociations: [],
        // Will be enriched later if needed
        riskLevel: this.calculateRiskLevel(fileViolations)
      };
    }
    const errorCount = violations.filter((v) => v.severity === "error").length;
    const warningCount = violations.filter((v) => v.severity === "warning").length;
    const complexityValues = allChunks.filter((c) => c.metadata.complexity !== void 0 && c.metadata.complexity > 0).map((c) => c.metadata.complexity);
    const avgComplexity = complexityValues.length > 0 ? complexityValues.reduce((sum, val) => sum + val, 0) / complexityValues.length : 0;
    const maxComplexity = complexityValues.length > 0 ? Math.max(...complexityValues) : 0;
    return {
      summary: {
        filesAnalyzed: analyzedFiles.size,
        totalViolations: violations.length,
        bySeverity: { error: errorCount, warning: warningCount },
        avgComplexity: Math.round(avgComplexity * 10) / 10,
        // Round to 1 decimal
        maxComplexity
      },
      files
    };
  }
  /**
   * Calculate risk level based on violations
   */
  calculateRiskLevel(violations) {
    if (violations.length === 0)
      return "low";
    const hasErrors = violations.some((v) => v.severity === "error");
    const errorCount = violations.filter((v) => v.severity === "error").length;
    if (errorCount >= 3)
      return "critical";
    if (hasErrors)
      return "high";
    if (violations.length >= 3)
      return "medium";
    return "low";
  }
  /**
   * Enrich files with violations with dependency data
   * This adds:
   * - List of dependent files (who imports this?)
   * - Boosted risk level based on dependents + complexity
   */
  enrichWithDependencies(report, allChunks) {
    const workspaceRoot = process.cwd();
    const filesWithViolations = Object.entries(report.files).filter(([_, data]) => data.violations.length > 0).map(([filepath, _]) => filepath);
    for (const filepath of filesWithViolations) {
      const fileData = report.files[filepath];
      const depAnalysis = analyzeDependencies(filepath, allChunks, workspaceRoot);
      fileData.dependents = depAnalysis.dependents.map((d) => d.filepath);
      fileData.dependentCount = depAnalysis.dependentCount;
      if (RISK_ORDER[depAnalysis.riskLevel] > RISK_ORDER[fileData.riskLevel]) {
        fileData.riskLevel = depAnalysis.riskLevel;
      }
      if (depAnalysis.complexityMetrics) {
        fileData.dependentComplexityMetrics = {
          averageComplexity: depAnalysis.complexityMetrics.averageComplexity,
          maxComplexity: depAnalysis.complexityMetrics.maxComplexity,
          filesWithComplexityData: depAnalysis.complexityMetrics.filesWithComplexityData
        };
      }
    }
  }
};

// ../core/dist/index.js
var loadConfig = (rootDir) => configService.load(rootDir);
var createDefaultConfig = () => defaultConfig;

// src/github.ts
import * as core from "@actions/core";
import * as github from "@actions/github";
function getPRContext() {
  const { context } = github;
  if (!context.payload.pull_request) {
    core.warning("This action only works on pull_request events");
    return null;
  }
  const pr = context.payload.pull_request;
  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pullNumber: pr.number,
    title: pr.title,
    baseSha: pr.base.sha,
    headSha: pr.head.sha
  };
}
async function getPRChangedFiles(octokit, prContext) {
  const files = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const response = await octokit.rest.pulls.listFiles({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      per_page: perPage,
      page
    });
    for (const file of response.data) {
      if (file.status !== "removed") {
        files.push(file.filename);
      }
    }
    if (response.data.length < perPage) {
      break;
    }
    page++;
  }
  return files;
}
async function postPRComment(octokit, prContext, body) {
  const existingComment = await findExistingComment(octokit, prContext);
  if (existingComment) {
    core.info(`Updating existing comment ${existingComment.id}`);
    await octokit.rest.issues.updateComment({
      owner: prContext.owner,
      repo: prContext.repo,
      comment_id: existingComment.id,
      body
    });
  } else {
    core.info("Creating new comment");
    await octokit.rest.issues.createComment({
      owner: prContext.owner,
      repo: prContext.repo,
      issue_number: prContext.pullNumber,
      body
    });
  }
}
async function findExistingComment(octokit, prContext) {
  const COMMENT_MARKER = "<!-- lien-ai-review -->";
  const comments = await octokit.rest.issues.listComments({
    owner: prContext.owner,
    repo: prContext.repo,
    issue_number: prContext.pullNumber
  });
  for (const comment of comments.data) {
    if (comment.body?.includes(COMMENT_MARKER)) {
      return { id: comment.id };
    }
  }
  return null;
}
async function getFileContent(octokit, prContext, filepath, startLine, endLine) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner: prContext.owner,
      repo: prContext.repo,
      path: filepath,
      ref: prContext.headSha
    });
    if ("content" in response.data) {
      const content = Buffer.from(response.data.content, "base64").toString(
        "utf-8"
      );
      const lines = content.split("\n");
      const snippet = lines.slice(startLine - 1, endLine).join("\n");
      return snippet;
    }
  } catch (error2) {
    core.warning(`Failed to get content for ${filepath}: ${error2}`);
  }
  return null;
}
function createOctokit(token) {
  return github.getOctokit(token);
}
async function postPRReview(octokit, prContext, comments, summaryBody) {
  if (comments.length === 0) {
    await postPRComment(octokit, prContext, summaryBody);
    return;
  }
  core.info(`Creating review with ${comments.length} line comments`);
  try {
    await octokit.rest.pulls.createReview({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      commit_id: prContext.headSha,
      event: "COMMENT",
      // Don't approve or request changes, just comment
      body: summaryBody,
      comments: comments.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body
      }))
    });
    core.info("Review posted successfully");
  } catch (error2) {
    core.warning(`Failed to post line comments: ${error2}`);
    core.info("Falling back to regular PR comment");
    await postPRComment(octokit, prContext, summaryBody);
  }
}
var DESCRIPTION_START_MARKER = "<!-- lien-stats -->";
var DESCRIPTION_END_MARKER = "<!-- /lien-stats -->";
async function updatePRDescription(octokit, prContext, badgeMarkdown) {
  try {
    const { data: pr } = await octokit.rest.pulls.get({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber
    });
    const currentBody = pr.body || "";
    const wrappedBadge = `${DESCRIPTION_START_MARKER}
${badgeMarkdown}
${DESCRIPTION_END_MARKER}`;
    let newBody;
    const startIdx = currentBody.indexOf(DESCRIPTION_START_MARKER);
    const endIdx = currentBody.indexOf(DESCRIPTION_END_MARKER);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      newBody = currentBody.slice(0, startIdx) + wrappedBadge + currentBody.slice(endIdx + DESCRIPTION_END_MARKER.length);
      core.info("Updating existing stats badge in PR description");
    } else {
      newBody = currentBody.trim() + "\n\n---\n\n" + wrappedBadge;
      core.info("Adding stats badge to PR description");
    }
    await octokit.rest.pulls.update({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      body: newBody
    });
    core.info("PR description updated with complexity stats");
  } catch (error2) {
    core.warning(`Failed to update PR description: ${error2}`);
  }
}
function parsePatchLines(patch) {
  const lines = /* @__PURE__ */ new Set();
  let currentLine = 0;
  for (const patchLine of patch.split("\n")) {
    const hunkMatch = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }
    if (patchLine.startsWith("+") || patchLine.startsWith(" ")) {
      if (!patchLine.startsWith("+++")) {
        lines.add(currentLine);
        currentLine++;
      }
    }
  }
  return lines;
}
async function getPRDiffLines(octokit, prContext) {
  const diffLines = /* @__PURE__ */ new Map();
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.listFiles, {
    owner: prContext.owner,
    repo: prContext.repo,
    pull_number: prContext.pullNumber,
    per_page: 100
  });
  for await (const response of iterator) {
    for (const file of response.data) {
      if (!file.patch) continue;
      const lines = parsePatchLines(file.patch);
      if (lines.size > 0) {
        diffLines.set(file.filename, lines);
      }
    }
  }
  return diffLines;
}

// src/openrouter.ts
import * as core3 from "@actions/core";

// src/prompt.ts
import collect2 from "collect.js";

// src/delta.ts
import * as core2 from "@actions/core";
import collect from "collect.js";
function getFunctionKey(filepath, symbolName, metricType) {
  return `${filepath}::${symbolName}::${metricType}`;
}
function buildComplexityMap(report, files) {
  if (!report) return /* @__PURE__ */ new Map();
  const entries = collect(files).map((filepath) => ({ filepath, fileData: report.files[filepath] })).filter(({ fileData }) => !!fileData).flatMap(
    ({ filepath, fileData }) => fileData.violations.map((violation) => [
      getFunctionKey(filepath, violation.symbolName, violation.metricType),
      { complexity: violation.complexity, violation }
    ])
  ).all();
  return new Map(entries);
}
function determineSeverity(baseComplexity, headComplexity, delta, threshold) {
  if (baseComplexity === null) return "new";
  if (delta < 0) return "improved";
  return headComplexity >= threshold * 2 ? "error" : "warning";
}
function createDelta(violation, baseComplexity, headComplexity, severity) {
  const delta = baseComplexity !== null && headComplexity !== null ? headComplexity - baseComplexity : headComplexity ?? -(baseComplexity ?? 0);
  return {
    filepath: violation.filepath,
    symbolName: violation.symbolName,
    symbolType: violation.symbolType,
    startLine: violation.startLine,
    metricType: violation.metricType,
    baseComplexity,
    headComplexity,
    delta,
    threshold: violation.threshold,
    severity
  };
}
function calculateDeltas(baseReport, headReport, changedFiles) {
  const baseMap = buildComplexityMap(baseReport, changedFiles);
  const headMap = buildComplexityMap(headReport, changedFiles);
  const seenBaseKeys = /* @__PURE__ */ new Set();
  const headDeltas = collect(Array.from(headMap.entries())).map(([key, headData]) => {
    const baseData = baseMap.get(key);
    if (baseData) seenBaseKeys.add(key);
    const baseComplexity = baseData?.complexity ?? null;
    const headComplexity = headData.complexity;
    const delta = baseComplexity !== null ? headComplexity - baseComplexity : headComplexity;
    const severity = determineSeverity(baseComplexity, headComplexity, delta, headData.violation.threshold);
    return createDelta(headData.violation, baseComplexity, headComplexity, severity);
  }).all();
  const deletedDeltas = collect(Array.from(baseMap.entries())).filter(([key]) => !seenBaseKeys.has(key)).map(([_, baseData]) => createDelta(baseData.violation, baseData.complexity, null, "deleted")).all();
  const deltas = [...headDeltas, ...deletedDeltas];
  deltas.sort((a, b) => {
    const severityOrder = { error: 0, warning: 1, new: 2, improved: 3, deleted: 4 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return b.delta - a.delta;
  });
  return deltas;
}
function calculateDeltaSummary(deltas) {
  const collection = collect(deltas);
  const categorized = collection.map((d) => {
    if (d.severity === "improved") return "improved";
    if (d.severity === "new") return "new";
    if (d.severity === "deleted") return "deleted";
    if (d.delta > 0) return "degraded";
    if (d.delta === 0) return "unchanged";
    return "improved";
  });
  const counts = categorized.countBy().all();
  return {
    totalDelta: collection.sum("delta"),
    improved: counts["improved"] || 0,
    degraded: counts["degraded"] || 0,
    newFunctions: counts["new"] || 0,
    deletedFunctions: counts["deleted"] || 0,
    unchanged: counts["unchanged"] || 0
  };
}
function formatDelta(delta) {
  if (delta > 0) return `+${delta} \u2B06\uFE0F`;
  if (delta < 0) return `${delta} \u2B07\uFE0F`;
  return "\xB10";
}
function formatSeverityEmoji(severity) {
  switch (severity) {
    case "error":
      return "\u{1F534}";
    case "warning":
      return "\u{1F7E1}";
    case "improved":
      return "\u{1F7E2}";
    case "new":
      return "\u{1F195}";
    case "deleted":
      return "\u{1F5D1}\uFE0F";
  }
}
function logDeltaSummary(summary) {
  const sign = summary.totalDelta >= 0 ? "+" : "";
  core2.info(`Complexity delta: ${sign}${summary.totalDelta}`);
  core2.info(`  Degraded: ${summary.degraded}, Improved: ${summary.improved}`);
  core2.info(`  New: ${summary.newFunctions}, Deleted: ${summary.deletedFunctions}`);
}

// src/format.ts
function formatTime(minutes) {
  const sign = minutes < 0 ? "-" : "";
  const roundedMinutes = Math.round(Math.abs(minutes));
  if (roundedMinutes >= 60) {
    const hours = Math.floor(roundedMinutes / 60);
    const mins = roundedMinutes % 60;
    return mins > 0 ? `${sign}${hours}h ${mins}m` : `${sign}${hours}h`;
  }
  return `${sign}${roundedMinutes}m`;
}
function formatDeltaValue(metricType, delta) {
  if (metricType === "halstead_bugs") {
    return delta.toFixed(2);
  }
  if (metricType === "halstead_effort") {
    return formatTime(delta);
  }
  return String(Math.round(delta));
}

// src/prompt.ts
function createDeltaKey(v) {
  return `${v.filepath}::${v.symbolName}::${v.metricType}`;
}
function buildDeltaMap(deltas) {
  if (!deltas) return /* @__PURE__ */ new Map();
  return new Map(
    collect2(deltas).map((d) => [createDeltaKey(d), d]).all()
  );
}
function getMetricLabel(metricType) {
  switch (metricType) {
    case "cognitive":
      return "mental load";
    case "cyclomatic":
      return "test paths";
    case "halstead_effort":
      return "time to understand";
    case "halstead_bugs":
      return "estimated bugs";
    default:
      return "complexity";
  }
}
function formatComplexityValue(metricType, value) {
  switch (metricType) {
    case "halstead_effort":
      return `~${formatTime(value)}`;
    case "halstead_bugs":
      return value.toFixed(2);
    case "cyclomatic":
      return `${value} tests`;
    default:
      return value.toString();
  }
}
function formatThresholdValue(metricType, value) {
  switch (metricType) {
    case "halstead_effort":
      return formatTime(value);
    case "halstead_bugs":
      return value.toFixed(1);
    default:
      return value.toString();
  }
}
function formatViolationLine(v, deltaMap) {
  const delta = deltaMap.get(createDeltaKey(v));
  const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : "";
  const metricLabel = getMetricLabel(v.metricType);
  const valueDisplay = formatComplexityValue(v.metricType, v.complexity);
  const thresholdDisplay = formatThresholdValue(v.metricType, v.threshold);
  return `  - ${v.symbolName} (${v.symbolType}): ${metricLabel} ${valueDisplay}${deltaStr} (threshold: ${thresholdDisplay}) [${v.severity}]`;
}
function buildViolationsSummary(files, deltaMap) {
  return Object.entries(files).filter(([_, data]) => data.violations.length > 0).map(([filepath, data]) => {
    const violationList = data.violations.map((v) => formatViolationLine(v, deltaMap)).join("\n");
    return `**${filepath}** (risk: ${data.riskLevel})
${violationList}`;
  }).join("\n\n");
}
function buildDeltaContext(deltas) {
  if (!deltas || deltas.length === 0) return "";
  const improved = deltas.filter((d) => d.severity === "improved");
  const degraded = deltas.filter((d) => (d.severity === "error" || d.severity === "warning") && d.delta > 0);
  const newFuncs = deltas.filter((d) => d.severity === "new");
  const deleted = deltas.filter((d) => d.severity === "deleted");
  const formatChange = (d) => {
    const from = d.baseComplexity ?? "new";
    const to = d.headComplexity ?? "removed";
    return `  - ${d.symbolName}: ${from} \u2192 ${to} (${formatDelta(d.delta)})`;
  };
  const sections = [
    `
## Complexity Changes (vs base branch)`,
    `- **Degraded**: ${degraded.length} function(s) got more complex`,
    `- **Improved**: ${improved.length} function(s) got simpler`,
    `- **New**: ${newFuncs.length} new complex function(s)`,
    `- **Removed**: ${deleted.length} complex function(s) deleted`
  ];
  if (degraded.length > 0) sections.push(`
Functions that got worse:
${degraded.map(formatChange).join("\n")}`);
  if (improved.length > 0) sections.push(`
Functions that improved:
${improved.map(formatChange).join("\n")}`);
  if (newFuncs.length > 0) sections.push(`
New complex functions:
${newFuncs.map((d) => `  - ${d.symbolName}: complexity ${d.headComplexity}`).join("\n")}`);
  return sections.join("\n");
}
function buildSnippetsSection(codeSnippets) {
  return Array.from(codeSnippets.entries()).map(([key, code]) => {
    const [filepath, symbolName] = key.split("::");
    return `### ${filepath} - ${symbolName}
\`\`\`
${code}
\`\`\``;
  }).join("\n\n");
}
function buildReviewPrompt(report, prContext, codeSnippets, deltas = null) {
  const { summary, files } = report;
  const deltaMap = buildDeltaMap(deltas);
  const violationsByFile = Object.entries(files).filter(([_, data]) => data.violations.length > 0);
  const violationsSummary = buildViolationsSummary(files, deltaMap);
  const snippetsSection = buildSnippetsSection(codeSnippets);
  const deltaContext = buildDeltaContext(deltas);
  return `# Code Complexity Review Request

## Context
- **Repository**: ${prContext.owner}/${prContext.repo}
- **PR**: #${prContext.pullNumber} - ${prContext.title}
- **Files with violations**: ${violationsByFile.length}
- **Total violations**: ${summary.totalViolations} (${summary.bySeverity.error} errors, ${summary.bySeverity.warning} warnings)
${deltaContext}
## Complexity Violations Found

${violationsSummary}

## Code Snippets

${snippetsSection || "_No code snippets available_"}

## Your Task

For each violation:
1. **Explain** why this complexity is problematic in this specific context
2. **Suggest** concrete refactoring steps (not generic advice like "break into smaller functions")
3. **Prioritize** which violations are most important to address - focus on functions that got WORSE (higher delta)
4. If the complexity seems justified for the use case, say so
5. Celebrate improvements! If a function got simpler, acknowledge it.

Format your response as a PR review comment with:
- A brief summary at the top (2-3 sentences)
- File-by-file breakdown with specific suggestions
- Prioritized list of recommended changes

Be concise but actionable. Focus on the highest-impact improvements.`;
}
function groupDeltasByMetric(deltas) {
  return collect2(deltas).groupBy("metricType").map((group) => group.sum("delta")).all();
}
function buildMetricBreakdownForDisplay(deltaByMetric) {
  const metricOrder = ["cyclomatic", "cognitive", "halstead_effort", "halstead_bugs"];
  const emojiMap = {
    cyclomatic: "\u{1F500}",
    cognitive: "\u{1F9E0}",
    halstead_effort: "\u23F1\uFE0F",
    halstead_bugs: "\u{1F41B}"
  };
  return collect2(metricOrder).map((metricType) => {
    const metricDelta = deltaByMetric[metricType] || 0;
    const emoji = emojiMap[metricType] || "\u{1F4CA}";
    const sign = metricDelta >= 0 ? "+" : "";
    return `${emoji} ${sign}${formatDeltaValue(metricType, metricDelta)}`;
  }).all().join(" | ");
}
function categorizeDeltas(deltas) {
  return deltas.reduce((acc, d) => {
    if (["improved", "deleted"].includes(d.severity)) acc.improved++;
    else if (["warning", "error", "new"].includes(d.severity)) acc.degraded++;
    return acc;
  }, { improved: 0, degraded: 0 });
}
function getTrendEmoji(totalDelta) {
  if (totalDelta > 0) return "\u2B06\uFE0F";
  if (totalDelta < 0) return "\u2B07\uFE0F";
  return "\u27A1\uFE0F";
}
function formatDeltaDisplay(deltas) {
  if (!deltas || deltas.length === 0) return "";
  const { improved, degraded } = categorizeDeltas(deltas);
  const deltaByMetric = groupDeltasByMetric(deltas);
  const metricBreakdown = buildMetricBreakdownForDisplay(deltaByMetric);
  const totalDelta = Object.values(deltaByMetric).reduce((sum, v) => sum + v, 0);
  const trend = getTrendEmoji(totalDelta);
  let display = `

**Complexity Change:** ${metricBreakdown} ${trend}`;
  if (improved > 0) display += ` | ${improved} improved`;
  if (degraded > 0) display += ` | ${degraded} degraded`;
  return display;
}
function formatTokenStats(tokenUsage) {
  if (!tokenUsage || tokenUsage.totalTokens <= 0) return "";
  return `
- Tokens: ${tokenUsage.totalTokens.toLocaleString()} ($${tokenUsage.cost.toFixed(4)})`;
}
function formatFallbackNote(isFallback) {
  if (!isFallback) return "";
  return `

> \u{1F4A1} *These violations exist in files touched by this PR but not on changed lines. Consider the [boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html): leave the code cleaner than you found it!*
`;
}
function formatReviewComment(aiReview, report, isFallback = false, tokenUsage, deltas) {
  const { summary } = report;
  const deltaDisplay = formatDeltaDisplay(deltas);
  const fallbackNote = formatFallbackNote(isFallback);
  const tokenStats = formatTokenStats(tokenUsage);
  return `<!-- lien-ai-review -->
## \u{1F441}\uFE0F Veille

${summary.totalViolations} issue${summary.totalViolations === 1 ? "" : "s"} spotted in this PR.${deltaDisplay}${fallbackNote}

---

${aiReview}

---

<details>
<summary>\u{1F4CA} Analysis Details</summary>

- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}${tokenStats}

</details>

*[Veille](https://lien.dev) by Lien*`;
}
function getViolationKey(violation) {
  return `${violation.filepath}::${violation.symbolName}`;
}
function determineStatus(report, deltaSummary) {
  const violations = report?.summary.totalViolations ?? 0;
  const errors = report?.summary.bySeverity.error ?? 0;
  const delta = deltaSummary?.totalDelta ?? 0;
  const newViolations = deltaSummary?.newFunctions ?? 0;
  const preExisting = Math.max(0, violations - newViolations);
  if (delta < 0) {
    if (preExisting > 0) {
      return {
        emoji: "\u2705",
        message: `**Improved!** Complexity reduced by ${Math.abs(delta)}. ${preExisting} pre-existing issue${preExisting === 1 ? "" : "s"} remain${preExisting === 1 ? "s" : ""} in touched files.`
      };
    }
    return { emoji: "\u2705", message: `**Improved!** This PR reduces complexity by ${Math.abs(delta)}.` };
  }
  if (newViolations > 0 && errors > 0) {
    return {
      emoji: "\u{1F534}",
      message: `**Review required** - ${newViolations} new function${newViolations === 1 ? " is" : "s are"} too complex.`
    };
  }
  if (newViolations > 0) {
    return {
      emoji: "\u26A0\uFE0F",
      message: `**Needs attention** - ${newViolations} new function${newViolations === 1 ? " is" : "s are"} more complex than recommended.`
    };
  }
  if (violations > 0) {
    return {
      emoji: "\u27A1\uFE0F",
      message: `**Stable** - ${preExisting} pre-existing issue${preExisting === 1 ? "" : "s"} in touched files (none introduced).`
    };
  }
  if (delta > 0) {
    return { emoji: "\u27A1\uFE0F", message: "**Stable** - Complexity increased slightly but within limits." };
  }
  return { emoji: "\u2705", message: "**Good** - No complexity issues found." };
}
function getMetricEmoji(metricType) {
  switch (metricType) {
    case "cyclomatic":
      return "\u{1F500}";
    case "cognitive":
      return "\u{1F9E0}";
    case "halstead_effort":
      return "\u23F1\uFE0F";
    case "halstead_bugs":
      return "\u{1F41B}";
    default:
      return "\u{1F4CA}";
  }
}
function buildDescriptionBadge(report, deltaSummary, deltas) {
  const status = determineStatus(report, deltaSummary);
  let metricTable = "";
  if (report && report.summary.totalViolations > 0) {
    const byMetric = collect2(Object.values(report.files)).flatMap((f) => f.violations).countBy("metricType").all();
    const deltaByMetric = deltas ? collect2(deltas).groupBy("metricType").map((group) => group.sum("delta")).all() : {};
    const metricOrder = ["cyclomatic", "cognitive", "halstead_effort", "halstead_bugs"];
    const rows = collect2(metricOrder).filter((metricType) => byMetric[metricType] > 0).map((metricType) => {
      const emoji = getMetricEmoji(metricType);
      const label = getMetricLabel(metricType);
      const count = byMetric[metricType];
      const delta = deltaByMetric[metricType] || 0;
      const deltaStr = deltas ? delta >= 0 ? `+${delta}` : `${delta}` : "\u2014";
      return `| ${emoji} ${label} | ${count} | ${deltaStr} |`;
    }).all();
    if (rows.length > 0) {
      metricTable = `
| Metric | Violations | Change |
|--------|:----------:|:------:|
${rows.join("\n")}
`;
    }
  }
  return `### \u{1F441}\uFE0F Veille

${status.emoji} ${status.message}
${metricTable}
*[Veille](https://lien.dev) by Lien*`;
}
function formatHalsteadContext(violation) {
  if (!violation.metricType?.startsWith("halstead_")) return "";
  if (!violation.halsteadDetails) return "";
  const details = violation.halsteadDetails;
  return `
**Halstead Metrics**: Volume: ${details.volume?.toLocaleString()}, Difficulty: ${details.difficulty?.toFixed(1)}, Effort: ${details.effort?.toLocaleString()}, Est. bugs: ${details.bugs?.toFixed(3)}`;
}
function buildBatchedCommentsPrompt(violations, codeSnippets) {
  const violationsText = violations.map((v, i) => {
    const key = `${v.filepath}::${v.symbolName}`;
    const snippet = codeSnippets.get(key);
    const snippetSection = snippet ? `
Code:
\`\`\`
${snippet}
\`\`\`` : "";
    const metricType = v.metricType || "cyclomatic";
    const metricLabel = getMetricLabel(metricType);
    const valueDisplay = formatComplexityValue(metricType, v.complexity);
    const thresholdDisplay = formatThresholdValue(metricType, v.threshold);
    const halsteadContext = formatHalsteadContext(v);
    return `### ${i + 1}. ${v.filepath}::${v.symbolName}
- **Function**: \`${v.symbolName}\` (${v.symbolType})
- **Complexity**: ${valueDisplay} ${metricLabel} (threshold: ${thresholdDisplay})${halsteadContext}
- **Severity**: ${v.severity}${snippetSection}`;
  }).join("\n\n");
  const jsonKeys = violations.map((v) => `  "${v.filepath}::${v.symbolName}": "your comment here"`).join(",\n");
  return `You are a senior engineer reviewing code for complexity. Generate thoughtful, context-aware review comments.

## Violations to Review

${violationsText}

## Instructions

For each violation, write a code review comment that:

1. **Identifies the specific pattern** causing complexity (not just "too complex")
   - Is it nested conditionals? Long parameter lists? Multiple responsibilities?
   - For Halstead metrics: many unique operators/operands, complex expressions
   - Be specific: "5 levels of nesting" not "deeply nested"

2. **Suggests a concrete fix** with a short code example (3-5 lines)
   - Consider: early returns, guard clauses, lookup tables, extracting helpers, strategy pattern
   - For Halstead: named constants, reducing operator variety, extracting complex expressions
   - Name specific functions: "Extract \`handleAdminCase()\`" not "extract a function"
   - Choose the SIMPLEST fix that addresses the issue (KISS principle)

3. **Acknowledges context** when relevant
   - If this is an orchestration function, complexity may be acceptable
   - If the logic is inherently complex (state machines, parsers), say so
   - Don't suggest over-engineering for marginal gains

Be direct and specific to THIS code. Avoid generic advice like "break into smaller functions."

IMPORTANT: Do NOT include headers like "Complexity: X" or emojis - we add those.

## Response Format

Respond with ONLY valid JSON. Each key is "filepath::symbolName", value is the comment text.
Use \\n for newlines within comments.

\`\`\`json
{
${jsonKeys}
}
\`\`\``;
}

// src/openrouter.ts
var OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
var totalUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cost: 0
};
function resetTokenUsage() {
  totalUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0
  };
}
function getTokenUsage() {
  return { ...totalUsage };
}
function trackUsage(usage) {
  if (!usage) return;
  totalUsage.promptTokens += usage.prompt_tokens;
  totalUsage.completionTokens += usage.completion_tokens;
  totalUsage.totalTokens += usage.total_tokens;
  totalUsage.cost += usage.cost || 0;
}
function parseCommentsResponse(content) {
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (codeBlockMatch ? codeBlockMatch[1] : content).trim();
  core3.info(`Parsing JSON response (${jsonStr.length} chars)`);
  try {
    const parsed = JSON.parse(jsonStr);
    core3.info(`Successfully parsed ${Object.keys(parsed).length} comments`);
    return parsed;
  } catch (parseError) {
    core3.warning(`Initial JSON parse failed: ${parseError}`);
  }
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      core3.info(`Recovered JSON with aggressive parsing: ${Object.keys(parsed).length} comments`);
      return parsed;
    } catch (retryError) {
      core3.warning(`Retry parsing also failed: ${retryError}`);
    }
  }
  core3.warning(`Full response content:
${content}`);
  return null;
}
async function generateReview(prompt, apiKey, model) {
  core3.info(`Calling OpenRouter with model: ${model}`);
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/getlien/lien",
      "X-Title": "Veille by Lien"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are an expert code reviewer. Provide actionable, specific feedback on code complexity issues. Be concise but thorough."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 2e3,
      temperature: 0.3,
      // Lower temperature for more consistent reviews
      // Enable usage accounting to get cost data
      // https://openrouter.ai/docs/guides/guides/usage-accounting
      usage: {
        include: true
      }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenRouter API error (${response.status}): ${errorText}`
    );
  }
  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error("No response from OpenRouter");
  }
  const review = data.choices[0].message.content;
  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : "";
    core3.info(
      `Tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`
    );
  }
  return review;
}
async function callBatchedCommentsAPI(prompt, apiKey, model) {
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/getlien/lien",
      "X-Title": "Veille by Lien"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are an expert code reviewer. Write detailed, actionable comments with specific refactoring suggestions. Respond ONLY with valid JSON."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 4096,
      temperature: 0.3,
      usage: { include: true }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }
  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error("No response from OpenRouter");
  }
  return data;
}
function mapCommentsToViolations(commentsMap, violations) {
  const results = /* @__PURE__ */ new Map();
  const fallbackMessage = (v) => `This ${v.symbolType} exceeds the complexity threshold. Consider refactoring to improve readability and testability.`;
  if (!commentsMap) {
    for (const violation of violations) {
      results.set(violation, fallbackMessage(violation));
    }
    return results;
  }
  for (const violation of violations) {
    const key = `${violation.filepath}::${violation.symbolName}`;
    const comment = commentsMap[key];
    if (comment) {
      results.set(violation, comment.replace(/\\n/g, "\n"));
    } else {
      core3.warning(`No comment generated for ${key}`);
      results.set(violation, fallbackMessage(violation));
    }
  }
  return results;
}
async function generateLineComments(violations, codeSnippets, apiKey, model) {
  if (violations.length === 0) {
    return /* @__PURE__ */ new Map();
  }
  core3.info(`Generating comments for ${violations.length} violations in single batch`);
  const prompt = buildBatchedCommentsPrompt(violations, codeSnippets);
  const data = await callBatchedCommentsAPI(prompt, apiKey, model);
  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : "";
    core3.info(`Batch tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`);
  }
  const commentsMap = parseCommentsResponse(data.choices[0].message.content);
  return mapCommentsToViolations(commentsMap, violations);
}

// src/index.ts
function getConfig() {
  const reviewStyle = core4.getInput("review_style") || "line";
  const enableDeltaTracking = core4.getInput("enable_delta_tracking") === "true";
  return {
    openrouterApiKey: core4.getInput("openrouter_api_key", { required: true }),
    model: core4.getInput("model") || "anthropic/claude-sonnet-4",
    threshold: core4.getInput("threshold") || "15",
    githubToken: core4.getInput("github_token") || process.env.GITHUB_TOKEN || "",
    reviewStyle: reviewStyle === "summary" ? "summary" : "line",
    enableDeltaTracking,
    baselineComplexityPath: core4.getInput("baseline_complexity") || ""
  };
}
function loadBaselineComplexity(path13) {
  if (!path13) {
    core4.info("No baseline complexity path provided, skipping delta calculation");
    return null;
  }
  try {
    if (!fs11.existsSync(path13)) {
      core4.warning(`Baseline complexity file not found: ${path13}`);
      return null;
    }
    const content = fs11.readFileSync(path13, "utf-8");
    const report = JSON.parse(content);
    if (!report.files || !report.summary) {
      core4.warning("Baseline complexity file has invalid format");
      return null;
    }
    core4.info(`Loaded baseline complexity: ${report.summary.totalViolations} violations`);
    return report;
  } catch (error2) {
    core4.warning(`Failed to load baseline complexity: ${error2}`);
    return null;
  }
}
function setupPRAnalysis() {
  const config = getConfig();
  core4.info(`Using model: ${config.model}`);
  core4.info(`Complexity threshold: ${config.threshold}`);
  core4.info(`Review style: ${config.reviewStyle}`);
  if (!config.githubToken) {
    throw new Error("GitHub token is required");
  }
  const prContext = getPRContext();
  if (!prContext) {
    core4.warning("Not running in PR context, skipping");
    return null;
  }
  core4.info(`Reviewing PR #${prContext.pullNumber}: ${prContext.title}`);
  return { config, prContext, octokit: createOctokit(config.githubToken) };
}
function filterAnalyzableFiles(files) {
  const codeExtensions = /* @__PURE__ */ new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".php"
  ]);
  const excludePatterns = [
    /node_modules\//,
    /vendor\//,
    /dist\//,
    /build\//,
    /\.min\./,
    /\.bundle\./,
    /\.generated\./,
    /package-lock\.json/,
    /yarn\.lock/,
    /pnpm-lock\.yaml/
  ];
  return files.filter((file) => {
    const ext2 = file.slice(file.lastIndexOf("."));
    if (!codeExtensions.has(ext2)) {
      return false;
    }
    for (const pattern of excludePatterns) {
      if (pattern.test(file)) {
        return false;
      }
    }
    return true;
  });
}
async function getFilesToAnalyze(octokit, prContext) {
  const allChangedFiles = await getPRChangedFiles(octokit, prContext);
  core4.info(`Found ${allChangedFiles.length} changed files in PR`);
  const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
  core4.info(`${filesToAnalyze.length} files eligible for complexity analysis`);
  return filesToAnalyze;
}
async function runComplexityAnalysis(files, threshold) {
  if (files.length === 0) {
    core4.info("No files to analyze");
    return null;
  }
  try {
    const rootDir = process.cwd();
    let config;
    try {
      config = await loadConfig(rootDir);
      core4.info("Loaded lien config");
    } catch {
      core4.info("No lien config found, using defaults");
      config = createDefaultConfig();
    }
    const thresholdNum = parseInt(threshold, 10);
    config.complexity = {
      ...config.complexity,
      enabled: true,
      thresholds: {
        testPaths: thresholdNum,
        mentalLoad: thresholdNum,
        timeToUnderstandMinutes: 60,
        estimatedBugs: 1.5,
        ...config.complexity?.thresholds
      }
    };
    core4.info("\u{1F4C1} Indexing codebase...");
    await indexCodebase({
      rootDir,
      config
    });
    core4.info("\u2713 Indexing complete");
    const vectorDB = await VectorDB.load(rootDir);
    core4.info("\u{1F50D} Analyzing complexity...");
    const analyzer = new ComplexityAnalyzer(vectorDB, config);
    const report = await analyzer.analyze(files);
    core4.info(`\u2713 Found ${report.summary.totalViolations} violations`);
    return report;
  } catch (error2) {
    core4.error(`Failed to run complexity analysis: ${error2}`);
    return null;
  }
}
async function prepareViolationsForReview(report, octokit, prContext) {
  const violations = Object.values(report.files).flatMap((fileData) => fileData.violations).sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return b.complexity - a.complexity;
  }).slice(0, 10);
  const codeSnippets = /* @__PURE__ */ new Map();
  for (const violation of violations) {
    const snippet = await getFileContent(
      octokit,
      prContext,
      violation.filepath,
      violation.startLine,
      violation.endLine
    );
    if (snippet) {
      codeSnippets.set(getViolationKey(violation), snippet);
    }
  }
  core4.info(`Collected ${codeSnippets.size} code snippets for review`);
  return { violations, codeSnippets };
}
async function analyzeBaseBranch(baseSha, filesToAnalyze, threshold) {
  try {
    core4.info(`Checking out base branch at ${baseSha.substring(0, 7)}...`);
    const currentHead = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    execSync(`git checkout --force ${baseSha}`, { stdio: "pipe" });
    core4.info("\u2713 Base branch checked out");
    core4.info("Analyzing base branch complexity...");
    const baseReport = await runComplexityAnalysis(filesToAnalyze, threshold);
    execSync(`git checkout --force ${currentHead}`, { stdio: "pipe" });
    core4.info("\u2713 Restored to HEAD");
    if (baseReport) {
      core4.info(`Base branch: ${baseReport.summary.totalViolations} violations`);
    }
    return baseReport;
  } catch (error2) {
    core4.warning(`Failed to analyze base branch: ${error2}`);
    try {
      const currentHead = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
      execSync(`git checkout --force ${currentHead}`, { stdio: "pipe" });
    } catch (restoreError) {
      core4.warning(`Failed to restore HEAD: ${restoreError}`);
    }
    return null;
  }
}
async function run() {
  try {
    core4.info("\u{1F680} Starting Lien AI Code Review...");
    core4.info(`Node version: ${process.version}`);
    core4.info(`Working directory: ${process.cwd()}`);
    const setup = setupPRAnalysis();
    if (!setup) {
      core4.info("\u26A0\uFE0F Setup returned null, exiting gracefully");
      return;
    }
    const { config, prContext, octokit } = setup;
    const filesToAnalyze = await getFilesToAnalyze(octokit, prContext);
    if (filesToAnalyze.length === 0) {
      core4.info("No analyzable files found, skipping review");
      return;
    }
    let baselineReport = null;
    if (config.enableDeltaTracking) {
      core4.info("\u{1F504} Delta tracking enabled - analyzing base branch...");
      baselineReport = await analyzeBaseBranch(prContext.baseSha, filesToAnalyze, config.threshold);
    } else if (config.baselineComplexityPath) {
      core4.warning("baseline_complexity input is deprecated. Use enable_delta_tracking: true instead.");
      baselineReport = loadBaselineComplexity(config.baselineComplexityPath);
    }
    const report = await runComplexityAnalysis(filesToAnalyze, config.threshold);
    if (!report) {
      core4.warning("Failed to get complexity report");
      return;
    }
    core4.info(`Analysis complete: ${report.summary.totalViolations} violations found`);
    const deltas = baselineReport ? calculateDeltas(baselineReport, report, filesToAnalyze) : null;
    const deltaSummary = deltas ? calculateDeltaSummary(deltas) : null;
    if (deltaSummary) {
      logDeltaSummary(deltaSummary);
      core4.setOutput("total_delta", deltaSummary.totalDelta);
      core4.setOutput("improved", deltaSummary.improved);
      core4.setOutput("degraded", deltaSummary.degraded);
    }
    const badge = buildDescriptionBadge(report, deltaSummary, deltas);
    await updatePRDescription(octokit, prContext, badge);
    if (report.summary.totalViolations === 0) {
      core4.info("No complexity violations found");
      return;
    }
    const { violations, codeSnippets } = await prepareViolationsForReview(report, octokit, prContext);
    resetTokenUsage();
    if (config.reviewStyle === "summary") {
      await postSummaryReview(octokit, prContext, report, codeSnippets, config, false, deltas);
    } else {
      await postLineReview(octokit, prContext, report, violations, codeSnippets, config, deltas);
    }
    core4.setOutput("violations", report.summary.totalViolations);
    core4.setOutput("errors", report.summary.bySeverity.error);
    core4.setOutput("warnings", report.summary.bySeverity.warning);
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : "An unexpected error occurred";
    const stack = error2 instanceof Error ? error2.stack : "";
    core4.error(`Action failed: ${message}`);
    if (stack) {
      core4.error(`Stack trace:
${stack}`);
    }
    core4.setFailed(message);
  }
}
function findCommentLine(violation, diffLines) {
  const fileLines = diffLines.get(violation.filepath);
  if (!fileLines) return null;
  if (fileLines.has(violation.startLine)) {
    return violation.startLine;
  }
  for (let line = violation.startLine; line <= violation.endLine; line++) {
    if (fileLines.has(line)) {
      return line;
    }
  }
  return null;
}
function createDeltaKey2(v) {
  return `${v.filepath}::${v.symbolName}::${v.metricType}`;
}
function buildDeltaMap2(deltas) {
  if (!deltas) return /* @__PURE__ */ new Map();
  return new Map(
    collect3(deltas).map((d) => [createDeltaKey2(d), d]).all()
  );
}
function buildLineComments(violationsWithLines, aiComments, deltaMap) {
  return collect3(violationsWithLines).filter(({ violation }) => aiComments.has(violation)).map(({ violation, commentLine }) => {
    const comment = aiComments.get(violation);
    const delta = deltaMap.get(createDeltaKey2(violation));
    const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : "";
    const severityEmoji = delta ? formatSeverityEmoji(delta.severity) : violation.severity === "error" ? "\u{1F534}" : "\u{1F7E1}";
    const lineNote = commentLine !== violation.startLine ? ` *(\`${violation.symbolName}\` starts at line ${violation.startLine})*` : "";
    const metricLabel = getMetricLabel(violation.metricType || "cyclomatic");
    const valueDisplay = formatComplexityValue(violation.metricType || "cyclomatic", violation.complexity);
    const thresholdDisplay = formatThresholdValue(violation.metricType || "cyclomatic", violation.threshold);
    core4.info(`Adding comment for ${violation.filepath}:${commentLine} (${violation.symbolName})${deltaStr}`);
    return {
      path: violation.filepath,
      line: commentLine,
      body: `${severityEmoji} **${metricLabel.charAt(0).toUpperCase() + metricLabel.slice(1)}: ${valueDisplay}**${deltaStr} (threshold: ${thresholdDisplay})${lineNote}

${comment}`
    };
  }).all();
}
function getMetricEmoji2(metricType) {
  switch (metricType) {
    case "cyclomatic":
      return "\u{1F500}";
    case "cognitive":
      return "\u{1F9E0}";
    case "halstead_effort":
      return "\u23F1\uFE0F";
    case "halstead_bugs":
      return "\u{1F41B}";
    default:
      return "\u{1F4CA}";
  }
}
function buildUncoveredNote(uncoveredViolations, deltaMap) {
  if (uncoveredViolations.length === 0) return "";
  const uncoveredList = uncoveredViolations.map((v) => {
    const delta = deltaMap.get(createDeltaKey2(v));
    const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : "";
    const emoji = getMetricEmoji2(v.metricType);
    const metricLabel = getMetricLabel(v.metricType || "cyclomatic");
    const valueDisplay = formatComplexityValue(v.metricType || "cyclomatic", v.complexity);
    return `* \`${v.symbolName}\` in \`${v.filepath}\`: ${emoji} ${metricLabel} ${valueDisplay}${deltaStr}`;
  }).join("\n");
  return `

<details>
<summary>\u26A0\uFE0F ${uncoveredViolations.length} violation${uncoveredViolations.length === 1 ? "" : "s"} outside diff (no inline comment)</summary>

${uncoveredList}

> \u{1F4A1} *These exist in files touched by this PR but the function declarations aren't in the diff. Consider the [boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html)!*

</details>`;
}
function buildSkippedNote(skippedViolations) {
  if (skippedViolations.length === 0) return "";
  const skippedList = skippedViolations.map((v) => `  - \`${v.symbolName}\` in \`${v.filepath}\`: complexity ${v.complexity}`).join("\n");
  return `

<details>
<summary>\u2139\uFE0F ${skippedViolations.length} pre-existing violation${skippedViolations.length === 1 ? "" : "s"} (unchanged)</summary>

${skippedList}

> *These violations existed before this PR and haven't changed. No inline comments added to reduce noise.*

</details>`;
}
function formatCostDisplay(usage) {
  return usage.totalTokens > 0 ? `
- Tokens: ${usage.totalTokens.toLocaleString()} ($${usage.cost.toFixed(4)})` : "";
}
function groupDeltasByMetric2(deltas) {
  return collect3(deltas).groupBy("metricType").map((group) => group.sum("delta")).all();
}
function buildMetricBreakdown(deltaByMetric) {
  const metricOrder = ["cyclomatic", "cognitive", "halstead_effort", "halstead_bugs"];
  return collect3(metricOrder).map((metricType) => {
    const metricDelta = deltaByMetric[metricType] || 0;
    const emoji = getMetricEmoji2(metricType);
    const sign = metricDelta >= 0 ? "+" : "";
    return `${emoji} ${sign}${formatDeltaValue(metricType, metricDelta)}`;
  }).all().join(" | ");
}
function formatDeltaDisplay2(deltas) {
  if (!deltas || deltas.length === 0) return "";
  const deltaSummary = calculateDeltaSummary(deltas);
  const deltaByMetric = groupDeltasByMetric2(deltas);
  const metricBreakdown = buildMetricBreakdown(deltaByMetric);
  const trend = deltaSummary.totalDelta > 0 ? "\u2B06\uFE0F" : deltaSummary.totalDelta < 0 ? "\u2B07\uFE0F" : "\u27A1\uFE0F";
  let display = `

**Complexity Change:** ${metricBreakdown} ${trend}`;
  if (deltaSummary.improved > 0) display += ` (${deltaSummary.improved} improved)`;
  if (deltaSummary.degraded > 0) display += ` (${deltaSummary.degraded} degraded)`;
  return display;
}
function buildReviewSummary(report, deltas, uncoveredNote) {
  const { summary } = report;
  const costDisplay = formatCostDisplay(getTokenUsage());
  const deltaDisplay = formatDeltaDisplay2(deltas);
  return `<!-- lien-ai-review -->
## \u{1F441}\uFE0F Veille

${summary.totalViolations} issue${summary.totalViolations === 1 ? "" : "s"} spotted in this PR.${deltaDisplay}

See inline comments on the diff for specific suggestions.${uncoveredNote}

<details>
<summary>\u{1F4CA} Analysis Details</summary>

- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}${costDisplay}

</details>

*[Veille](https://lien.dev) by Lien*`;
}
async function postLineReview(octokit, prContext, report, violations, codeSnippets, config, deltas = null) {
  const diffLines = await getPRDiffLines(octokit, prContext);
  core4.info(`Diff covers ${diffLines.size} files`);
  const violationsWithLines = [];
  const uncoveredViolations = [];
  for (const v of violations) {
    const commentLine = findCommentLine(v, diffLines);
    if (commentLine !== null) {
      violationsWithLines.push({ violation: v, commentLine });
    } else {
      uncoveredViolations.push(v);
    }
  }
  core4.info(
    `${violationsWithLines.length}/${violations.length} violations can have inline comments (${uncoveredViolations.length} outside diff)`
  );
  const deltaMap = buildDeltaMap2(deltas);
  const newOrDegradedViolations = violationsWithLines.filter(({ violation }) => {
    const key = createDeltaKey2(violation);
    const delta = deltaMap.get(key);
    return !delta || delta.severity === "new" || delta.delta > 0;
  });
  const skippedCount = violationsWithLines.length - newOrDegradedViolations.length;
  if (skippedCount > 0) {
    core4.info(`Skipping ${skippedCount} unchanged pre-existing violations (no LLM calls needed)`);
  }
  if (newOrDegradedViolations.length === 0) {
    core4.info("No new or degraded violations to comment on");
    if (violationsWithLines.length > 0) {
      const uncoveredNote2 = buildUncoveredNote(uncoveredViolations, deltaMap);
      const skippedInDiff = violationsWithLines.filter(({ violation }) => {
        const key = createDeltaKey2(violation);
        const delta = deltaMap.get(key);
        return delta && delta.severity !== "new" && delta.delta === 0;
      }).map((v) => v.violation);
      const skippedNote2 = buildSkippedNote(skippedInDiff);
      const summaryBody2 = buildReviewSummary(report, deltas, uncoveredNote2 + skippedNote2);
      await postPRComment(octokit, prContext, summaryBody2);
    }
    return;
  }
  const commentableViolations = newOrDegradedViolations.map((v) => v.violation);
  core4.info(`Generating AI comments for ${commentableViolations.length} new/degraded violations...`);
  const aiComments = await generateLineComments(
    commentableViolations,
    codeSnippets,
    config.openrouterApiKey,
    config.model
  );
  const lineComments = buildLineComments(newOrDegradedViolations, aiComments, deltaMap);
  core4.info(`Built ${lineComments.length} line comments for new/degraded violations`);
  const skippedViolations = violationsWithLines.filter(({ violation }) => {
    const key = createDeltaKey2(violation);
    const delta = deltaMap.get(key);
    return delta && delta.severity !== "new" && delta.delta === 0;
  }).map((v) => v.violation);
  const uncoveredNote = buildUncoveredNote(uncoveredViolations, deltaMap);
  const skippedNote = buildSkippedNote(skippedViolations);
  const summaryBody = buildReviewSummary(report, deltas, uncoveredNote + skippedNote);
  await postPRReview(octokit, prContext, lineComments, summaryBody);
  core4.info(`Posted review with ${lineComments.length} line comments`);
}
async function postSummaryReview(octokit, prContext, report, codeSnippets, config, isFallback = false, deltas = null) {
  const prompt = buildReviewPrompt(report, prContext, codeSnippets, deltas);
  core4.debug(`Prompt length: ${prompt.length} characters`);
  const aiReview = await generateReview(
    prompt,
    config.openrouterApiKey,
    config.model
  );
  const usage = getTokenUsage();
  const comment = formatReviewComment(aiReview, report, isFallback, usage, deltas);
  await postPRComment(octokit, prContext, comment);
  core4.info("Successfully posted AI review summary comment");
}
run().catch((error2) => {
  core4.setFailed(error2 instanceof Error ? error2.message : String(error2));
  process.exit(1);
});
//# sourceMappingURL=index.js.map