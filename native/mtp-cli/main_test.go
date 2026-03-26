package main

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// helper: spawn the mtp-cli binary, send a JSON command via stdin,
// and return the first JSON line from stdout.
func runCLI(t *testing.T, request map[string]interface{}) map[string]interface{} {
	t.Helper()

	binPath := "./mtp-cli"
	if _, err := os.Stat(binPath); os.IsNotExist(err) {
		t.Skip("mtp-cli binary not found; run 'CGO_ENABLED=1 go build -o mtp-cli .' first")
	}

	cmd := exec.Command(binPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatalf("stdin pipe: %v", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}

	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}

	reqBytes, _ := json.Marshal(request)
	_, _ = io.WriteString(stdin, string(reqBytes)+"\n")
	stdin.Close()

	scanner := bufio.NewScanner(stdout)
	var result map[string]interface{}
	if scanner.Scan() {
		line := scanner.Text()
		if err := json.Unmarshal([]byte(line), &result); err != nil {
			t.Fatalf("failed to parse response JSON: %v (line: %s)", err, line)
		}
	} else {
		t.Fatal("no output from mtp-cli")
	}

	_ = cmd.Wait()
	return result
}

// --- delete command tests ---

func TestDelete_MissingPaths(t *testing.T) {
	// "delete" with no paths field should return an error
	resp := runCLI(t, map[string]interface{}{
		"cmd":       "delete",
		"storageId": "0",
	})
	errMsg, ok := resp["error"].(string)
	if !ok || errMsg == "" {
		t.Fatalf("expected error for missing paths, got: %v", resp)
	}
	if !strings.Contains(errMsg, "missing paths") {
		t.Errorf("expected 'missing paths' in error, got: %s", errMsg)
	}
}

func TestDelete_EmptyPaths(t *testing.T) {
	// "delete" with an empty paths array should return an error
	resp := runCLI(t, map[string]interface{}{
		"cmd":       "delete",
		"storageId": "0",
		"paths":     []string{},
	})
	errMsg, ok := resp["error"].(string)
	if !ok || errMsg == "" {
		t.Fatalf("expected error for empty paths, got: %v", resp)
	}
	if !strings.Contains(errMsg, "missing paths") {
		t.Errorf("expected 'missing paths' in error, got: %s", errMsg)
	}
}

func TestDelete_NoDevice(t *testing.T) {
	// "delete" with valid paths but no device connected should return
	// an MTP initialization error (not a crash or panic).
	resp := runCLI(t, map[string]interface{}{
		"cmd":       "delete",
		"storageId": "0",
		"paths":     []string{"/MUSIC/test.flac"},
	})
	// Without a device, mtpx.Initialize will fail.
	// We just verify the process handles it gracefully with an error response.
	errMsg, hasErr := resp["error"].(string)
	okVal, hasOk := resp["ok"]
	if hasErr && errMsg != "" {
		// Expected: graceful error when no device connected
		t.Logf("got expected error (no device): %s", errMsg)
	} else if hasOk && okVal == true {
		// A device was actually connected and delete succeeded — also acceptable
		t.Logf("device was connected, delete returned ok (test environment has MTP device)")
	} else {
		t.Fatalf("unexpected response: %v", resp)
	}
}

// --- general protocol tests ---

func TestUnknownCommand(t *testing.T) {
	resp := runCLI(t, map[string]interface{}{
		"cmd": "nonexistent_command",
	})
	errMsg, ok := resp["error"].(string)
	if !ok || !strings.Contains(errMsg, "unknown cmd") {
		t.Fatalf("expected 'unknown cmd' error, got: %v", resp)
	}
}

func TestMissingCmd(t *testing.T) {
	resp := runCLI(t, map[string]interface{}{
		"foo": "bar",
	})
	errMsg, ok := resp["error"].(string)
	if !ok || !strings.Contains(errMsg, "missing cmd") {
		t.Fatalf("expected 'missing cmd' error, got: %v", resp)
	}
}
