---
title: "The Nudges Are Only as Good as the Data Under Them"
description: "We shipped a stack of nudges that check in on an agent's work automatically. Most of them depend on knowing which tests cover which files, data we hadn't tested against real code until we pointed Lien at nine real open-source projects and read what it actually said."
date: 2026-07-25
author: Alf Henderson
tags: [evidence, languages, architecture]
draft: true
---

<!-- DRAFT: awaiting owner voice pass -->

# The Nudges Are Only as Good as the Data Under Them

Lien is a tool that gives AI coding agents a structural understanding of a
codebase, and it runs entirely on your own machine. Over the past few
releases we shipped a small stack of things that check in on an agent's
work without it having to ask: a complexity check that speaks up the
moment an edit makes a function meaningfully harder to follow, [a warning
when an edit changes or removes an exported function's
signature](https://github.com/getlien/lien/pull/841), including how many
of that function's callers have no test covering them at all (and, more
recently, [whether a removed export still has documentation pointing at
it](https://github.com/getlien/lien/pull/845)), [a reminder about which
tests go with a file you just changed](https://github.com/getlien/lien/pull/843),
[a single advisory at the end of a session naming whatever risk from all
of the above is still unresolved](https://github.com/getlien/lien/pull/855),
and [telemetry tracking whether any of this is actually being acted
on](https://github.com/getlien/lien/pull/847). Different nudges doing
different jobs, but most of them ultimately depend on the same underlying
fact: which files import which, and which tests actually cover which
files.

That's the part we hadn't properly tested. Every one of those nudges
shipped with its own unit suite green the whole time. A green suite only
proves the code does what the tests describe, and every test we had
written described the one situation we already understood well: our own
codebase, written mostly in TypeScript. We hold ourselves to a rule for
changes like this: a clean build and a passing suite are necessary, never
sufficient, and you exercise the change the way its real user experiences
it before calling it done. So we did the product-level version of that. We
installed Lien against real, unmodified projects in every language we
claim to support, nine of them, across nine ecosystems, and read what it
actually told us instead of trusting our own fixtures.

For most non-JavaScript languages, what it told us was wrong, in a
different way each time, and none of it had ever shown up as a failing
test.

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
Go, Ruby, and C#, which means the whole stack above, the test reminder,
the session recap, the blast-radius warning's untested-caller count, is
reading real data on those languages now, not a guess. Kotlin's own
matching was already correct; only its did-you-actually-run-the-tests
signal needed the fix, for its own idiomatic invocation. Swift's
whole-module shape gets an honest label instead of a guess, for the
reason above. None of it shipped as one release. It went out language by
language, real repo by real repo, over two days.

The lesson we're taking from this isn't really about these seven bugs. A
green test suite told us nothing about whether any of it worked on code we
hadn't written ourselves. The only way we actually found out was by
running the real thing against real code.
