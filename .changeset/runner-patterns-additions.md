---
"@liendev/lien": patch
---

`RUNNER_PATTERNS` in the did-you-run-the-tests nudge (`lien verify-tests
note-run`) now recognizes each swept ecosystem's own standard test-invocation
form: Ruby's Rake/Minitest convention (`rake test`, `rake test:core`,
`bundle exec rake test:core`, or any other `test:<namespaced-task>` form),
PHP's vendored/wrapped phpunit
(`vendor/bin/phpunit`, `./vendor/bin/phpunit`) and Composer script alias
(`composer test`), Swift's SwiftPM invocation (`swift test`, `swift test
--filter X`), and the Gradle wrapper script (`./gradlew test`, `./gradlew
:module:test`, `gradlew test`). Previously these commands silently failed to
register as a test run, so the nudge kept nagging even after the correct
tests had genuinely been run. Purely additive recognition — `isCoveredByScope`
is untouched, and the only existing pattern modification is folding the bare
`phpunit` pattern into a strict superset that also matches vendored paths;
every other existing pattern is unchanged, so no prior classification moves.
