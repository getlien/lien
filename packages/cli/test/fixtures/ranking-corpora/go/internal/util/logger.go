// Package util provides shared logging helpers used throughout the
// ranking-go fixture corpus. It is deliberately the "hub" package here:
// every handler imports it, which is exactly the shape a real Go project's
// most-depended-on package takes (e.g. an internal logging or config
// package).
package util

import "fmt"

// LogInfo writes an informational message to stdout, prefixed so it is easy
// to tell apart from error output in test fixtures.
func LogInfo(message string) {
	fmt.Printf("[info] %s\n", message)
}

// LogError writes an error message to stdout, wrapping err with context.
func LogError(context string, err error) {
	fmt.Printf("[error] %s: %v\n", context, err)
}
