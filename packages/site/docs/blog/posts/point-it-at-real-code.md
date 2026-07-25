---
title: "Was Our Test-Coverage Check Actually Right for Every Language We Claimed?"
description: "We pointed Lien at real, unmodified open-source projects across nine programming languages and found the feature that tells an agent which tests cover the file it just edited was silently wrong on almost every one of them, in a different way each time."
date: 2026-07-25
author: Alf Henderson
tags: [evidence, languages, architecture]
draft: true
---

<!-- DRAFT: awaiting owner voice pass -->

# Was Our Test-Coverage Check Actually Right for Every Language We Claimed?

Lien is a tool that gives AI coding agents a structural understanding of a
codebase, including which tests actually cover the file an agent just
changed, and it runs entirely on your own machine. That last part, test
coverage, is one of the plainer things Lien does: an agent edits a file,
Lien tells it which test files go with that file, and the agent knows what
to run before calling the work done.

We assumed that part worked. It was one of the earlier features we built,
and it had been running quietly for a long time without complaint. Then we
pointed it at real, unmodified open-source projects in languages other than
the one Lien itself is written in, nine of them, across nine ecosystems.
What came back wasn't a small correction. For most non-JavaScript
languages, the feature was either silently broken or actively lying, and
had been the whole time.

## What was actually happening

[Starlette](https://github.com/encode/starlette), a well-known Python web
framework, was the clearest case. Every source file we checked had an
obvious, correctly named test file sitting right next to it. Lien reported
none of them. The bug was almost embarrassingly simple: Lien's Python
import reader was handing back the entire, unparsed line of code instead of
just the module path buried inside it, so nothing downstream could ever
match it against a real file. [We fixed the reader
itself](https://github.com/getlien/lien/pull/861), then checked every other
language's import reader for the same class of mistake. Two smaller
versions turned up, in Rust and in PHP, [both fixed in the same
pass](https://github.com/getlien/lien/pull/865). TypeScript and JavaScript,
the languages Lien is written in, came back clean, confirmed the same way,
by testing against [zod](https://github.com/colinhacks/zod), a real,
popular TypeScript library, not just our own code.

PHP and Go had a different problem, one level up. [Guzzle](https://github.com/guzzle/guzzle)
(PHP) and [Gin](https://github.com/gin-gonic/gin) (Go) both use the
standard way their ecosystems lay out a project: a manifest file,
`composer.json` for PHP or `go.mod` for Go, that declares how an import
name maps onto the real folder structure. Lien had never read either
manifest, and its guess at the mapping failed on both projects' default
layout: every source file in both repos came back with no test coverage,
despite complete, passing test suites sitting right there. [Fixed by
teaching Lien to read the two manifests
directly](https://github.com/getlien/lien/pull/877), the same way it
already reads a JavaScript monorepo's own workspace file.

The .NET ecosystem had a naming problem instead. [AutoMapper](https://github.com/AutoMapper/AutoMapper),
a widely used .NET library, names its test project `AutoMapper.Tests` and
its test files `FooTests.cs`, the standard xUnit, NUnit, and MSTest
convention. Lien's test-file detector only recognized a `test` or `spec`
word in its own path segment, or `.test.`/`.spec.` right before the
extension, and neither pattern matches `Tests` stuck onto the end of a
longer word. [Fixed by adding the convention
explicitly](https://github.com/getlien/lien/pull/874).

The worst version of this bug wasn't silence, it was false confidence.
[Sinatra](https://github.com/sinatra/sinatra), a Ruby web framework, ships
one file, `lib/sinatra.rb`, that every other file in the gem quietly
depends on through a bare `require 'sinatra'`. Lien's matcher treated that
bare name as a hit against any file under `lib/sinatra/`, so it reported
every file in the gem as tested by every other file's tests, a wrong
answer delivered with exactly the same confidence as a right one. The
same shape misattributed one Go file's real dependents to an unrelated
file sharing part of its name, and, in a Swift project, let a system
framework import collide with an unrelated local file of a similar name.
[Fixed with one shared rule](https://github.com/getlien/lien/pull/883): a
bare, path-free import name no longer wins a match against a file it
doesn't actually name.

Kotlin's own matching was already correct. What wasn't working was the
separate nudge confirming an agent actually ran the tests it was told
about: Kotlin's idiomatic `./gradlew test` wasn't recognized as a test run
at all, so the nudge kept asking even after the right tests had genuinely
run. [Fixed alongside the same gap in Ruby, PHP, and Swift's own
test-invocation conventions](https://github.com/getlien/lien/pull/873).

## When there's really nothing to go on

Not every gap has a fix. Swift's `import Alamofire`, or any whole-module
import, doesn't carry a signal Lien, or anyone, could recover: every test
file in the module writes the exact same bare import, so there's no way to
tell which specific source file a given test actually covers from the
import alone. Guessing anyway, by name proximity, would have looked like a
fix and been wrong just as often as before. Instead, for this shape, Lien
now says so directly:

```text
Test coverage not determinable from imports (whole-module import).
```

instead of the confident, wrong `No test coverage.` it used to print.
[Fixed here](https://github.com/getlien/lien/pull/881). It's the same
instinct behind publishing our own review misses elsewhere on this site:
an honest "we don't know" beats a wrong answer delivered with a straight
face.

## The tool catching its own fix's gaps

The very last bug in this batch turned into the best argument for a habit
we already had. [Alamofire](https://github.com/Alamofire/Alamofire) has
one file, `Source/Alamofire.swift`, a 43-line stub whose own name
coincidentally matches the module's name, so it kept falsely absorbing
every one of that whole-module import's roughly 38 test files, as if all
of them specifically tested that one small file. Fixing it meant finding
every place in Lien's own code that independently reimplements the same
"does this import match this file" check, since the same mistake had been
made in more than one place, not just one.

Grounding through the codebase by hand found two of those places. Lien
Review, our own automated pull-request reviewer, running on our own pull
request while it fixed this exact bug, found five more, across three
separate review rounds, each round catching a spot the round before it had
missed. Seven places total needed the same one-line fix. Five of the seven
were caught by the tool we were in the middle of fixing everything else
for.

## Where it stands now

Test-association discovery, and the dependents lookups underneath it, now
work on the mainstream convention in TypeScript, JavaScript, Python, PHP,
Go, Ruby, and C#. Kotlin's own matching was already correct; only its
did-you-actually-run-the-tests nudge needed the fix, for its own
idiomatic invocation. Swift's whole-module shape gets an honest label
instead of a guess, for the reason above. None of it shipped as one
release. It went out language by language, real repo by real repo, over
two days.
