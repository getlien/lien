---
"@liendev/lien": patch
---

`RUNNER_PATTERNS` in the did-you-run-the-tests nudge (`lien verify-tests
note-run`) now recognizes each swept ecosystem's own standard test-invocation
form: Ruby's Rake/Minitest convention (`rake test`, `rake test:core`,
`bundle exec rake test[:sub]`), PHP's vendored/wrapped phpunit
(`vendor/bin/phpunit`, `./vendor/bin/phpunit`) and Composer script alias
(`composer test`), Swift's SwiftPM invocation (`swift test`, `swift test
--filter X`), and the Gradle wrapper script (`./gradlew test`, `./gradlew
:module:test`, `gradlew test`). Previously these commands silently failed to
register as a test run, so the nudge kept nagging even after the correct
tests had genuinely been run. Purely additive recognition — `isCoveredByScope`
and every existing pattern are unchanged, so no prior classification moves.
