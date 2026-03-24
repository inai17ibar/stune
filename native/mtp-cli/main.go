// sTune MTP CLI: JSON over stdin/stdout で go-mtpx を駆動する。
// ビルド: CGO_ENABLED=1 go build -o mtp-cli .
// 前提: brew install libusb pkg-config
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/ganeshrvel/go-mtpx"
)

func out(obj interface{}) {
	b, _ := json.Marshal(obj)
	fmt.Println(string(b))
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var req map[string]json.RawMessage
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			out(map[string]string{"error": "invalid json"})
			continue
		}
		cmdRaw, ok := req["cmd"]
		if !ok {
			out(map[string]string{"error": "missing cmd"})
			continue
		}
		var cmd string
		if err := json.Unmarshal(cmdRaw, &cmd); err != nil {
			out(map[string]string{"error": "invalid cmd"})
			continue
		}
		switch cmd {
		case "list_storages":
			handleListStorages()
		case "list_files":
			handleListFiles(req)
		case "upload":
			handleUpload(req)
		case "download":
			handleDownload(req)
		case "delete":
			handleDelete(req)
		default:
			out(map[string]string{"error": "unknown cmd: " + cmd})
		}
	}
}

func handleListStorages() {
	dev, err := mtpx.Initialize(mtpx.Init{})
	if err != nil {
		out(map[string]string{"error": err.Error()})
		return
	}
	defer mtpx.Dispose(dev)
	info, err := mtpx.FetchDeviceInfo(dev)
	if err != nil {
		out(map[string]string{"error": err.Error()})
		return
	}
	storages, err := mtpx.FetchStorages(dev)
	if err != nil {
		out(map[string]string{"error": err.Error()})
		return
	}
	deviceName := ""
	if info != nil {
		if info.Model != "" {
			deviceName = info.Model
		} else if info.Manufacturer != "" {
			deviceName = info.Manufacturer
		}
	}
	outStorages := make([]map[string]interface{}, 0, len(storages))
	for _, s := range storages {
		outStorages = append(outStorages, map[string]interface{}{
			"storageId":        strconv.FormatUint(uint64(s.Sid), 10),
			"description":      "",
			"maxCapacity":      s.Info.MaxCapability,
			"freeSpaceInBytes": s.Info.FreeSpaceInBytes,
		})
	}
	out(map[string]interface{}{
		"storages":   outStorages,
		"deviceName": deviceName,
	})
}

func handleListFiles(req map[string]json.RawMessage) {
	var storageId string
	var pathStr string
	_ = json.Unmarshal(req["storageId"], &storageId)
	_ = json.Unmarshal(req["path"], &pathStr)
	if pathStr == "" {
		pathStr = "/"
	}
	sid, _ := strconv.ParseUint(storageId, 10, 32)
	storageIdU32 := uint32(sid)

	dev, err := mtpx.Initialize(mtpx.Init{})
	if err != nil {
		out(map[string]string{"error": err.Error()})
		return
	}
	defer mtpx.Dispose(dev)

	var files []map[string]interface{}
	_, _, _, err = mtpx.Walk(dev, storageIdU32, pathStr, false, true, false, func(objectId uint32, fi *mtpx.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if fi == nil {
			return nil
		}
		files = append(files, map[string]interface{}{
			"objectId": objectId,
			"name":     fi.Name,
			"fullPath": fi.FullPath,
			"size":     fi.Size,
			"isDir":    fi.IsDir,
		})
		return nil
	})
	if err != nil {
		out(map[string]string{"error": err.Error()})
		return
	}
	out(map[string]interface{}{"files": files})
}

func handleUpload(req map[string]json.RawMessage) {
	var storageId, source, destination string
	_ = json.Unmarshal(req["storageId"], &storageId)
	_ = json.Unmarshal(req["source"], &source)
	_ = json.Unmarshal(req["destination"], &destination)
	if source == "" || destination == "" {
		out(map[string]string{"error": "missing source or destination"})
		return
	}
	sid, _ := strconv.ParseUint(storageId, 10, 32)
	storageIdU32 := uint32(sid)

	dev, err := mtpx.Initialize(mtpx.Init{})
	if err != nil {
		out(map[string]string{"error": err.Error()})
		return
	}
	defer mtpx.Dispose(dev)

	_, _, _, err = mtpx.UploadFiles(dev, storageIdU32, []string{source}, destination, false, nil, func(*mtpx.ProgressInfo, error) error { return nil })
	if err != nil {
		out(map[string]string{"error": err.Error()})
		return
	}
	out(map[string]bool{"ok": true})
}

func handleDelete(req map[string]json.RawMessage) {
	var storageId string
	_ = json.Unmarshal(req["storageId"], &storageId)

	var paths []string
	_ = json.Unmarshal(req["paths"], &paths)
	if len(paths) == 0 {
		out(map[string]string{"error": "missing paths"})
		return
	}
	sid, _ := strconv.ParseUint(storageId, 10, 32)
	storageIdU32 := uint32(sid)

	dev, err := mtpx.Initialize(mtpx.Init{})
	if err != nil {
		out(map[string]string{"error": err.Error()})
		return
	}
	defer mtpx.Dispose(dev)

	var fileProps []mtpx.FileProp
	for _, p := range paths {
		fileProps = append(fileProps, mtpx.FileProp{ObjectId: 0, FullPath: p})
	}

	err = mtpx.DeleteFile(dev, storageIdU32, fileProps)
	if err != nil {
		out(map[string]string{"error": err.Error()})
		return
	}
	out(map[string]interface{}{"ok": true, "deletedCount": len(paths)})
}

func handleDownload(req map[string]json.RawMessage) {
	var storageId, source, destination string
	_ = json.Unmarshal(req["storageId"], &storageId)
	_ = json.Unmarshal(req["source"], &source)
	_ = json.Unmarshal(req["destination"], &destination)
	if source == "" || destination == "" {
		out(map[string]string{"error": "missing source or destination"})
		return
	}
	sid, _ := strconv.ParseUint(storageId, 10, 32)
	storageIdU32 := uint32(sid)

	dev, err := mtpx.Initialize(mtpx.Init{})
	if err != nil {
		out(map[string]string{"error": err.Error()})
		return
	}
	defer mtpx.Dispose(dev)

	_, _, err = mtpx.DownloadFiles(dev, storageIdU32, []string{source}, destination, false, nil, func(*mtpx.ProgressInfo, error) error { return nil })
	if err != nil {
		out(map[string]string{"error": err.Error()})
		return
	}
	out(map[string]bool{"ok": true})
}
