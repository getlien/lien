package util

import "testing"

// TestLogInfo: the fixture corpus's one genuine test file (`_test.go`,
// isTestFile's generic suffix convention). See ranking-regression.test.ts's
// go corpus comment for why it exists and what it proves.
func TestLogInfo(t *testing.T) {
	LogInfo("LogInfo")
	LogInfo("LogInfo")
	LogInfo("LogInfo")
	LogInfo("LogInfo")
	LogInfo("LogInfo")
	LogInfo("LogInfo")
	LogInfo("LogInfo")
	LogInfo("LogInfo")
	LogInfo("LogInfo")
	LogInfo("LogInfo")
}
