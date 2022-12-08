package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync/atomic"
	"time"
	"io/ioutil"
	"github.com/r3labs/sse/v2"
)

type OutgoingMessage struct {
	DeviceId string `json:"deviceId"`
	Payload  string `json:"payload"`
}

type IncomingMessage struct {
	//Sender  string         `json:"sender"`
	//Payload BodyWithCseqID `json:"encPayload"`
	SeqID uint64 `json:"seqID"`
}

type Batch struct {
	Batch []OutgoingMessage `json:"batch"`
}

var myDeviceId string

var serverAddr string = "http://localhost:8080"

var httpClient *http.Client

// var record bool = false;

var numHead uint64
var numTail uint64

func req(reqType string, jsonStr []byte, path string) *http.Response {
	req, _ := http.NewRequest(reqType, serverAddr+path, bytes.NewBuffer(jsonStr))
	req.Header = http.Header{
		"Content-Type":  {"application/json"},
		"Authorization": {"Bearer " + myDeviceId},
	}
	resp, err := httpClient.Do(req)
	defer resp.Body.Close()

	if err != nil {
		panic(err)
	}

	ioutil.ReadAll(resp.Body)
	return resp
}

func delete(seqID uint64) {
	delMsg := fmt.Sprintf(`{"seqID" : %v }`, seqID)
	req("DELETE", []byte(delMsg), "/self/messages")
}

func readParams(){
	myDeviceId = os.Args[1]
	if len(os.Args) < 3 {
		serverAddr = "http://localhost:8080"
	} else {
		serverAddr = os.Args[2]
	}
}

func main() {
	readParams()
	client := sse.NewClient(serverAddr + "/events")
	client.Headers["Authorization"] = "Bearer " + myDeviceId

	messageReceived := make(chan int, 1)
	var maxSeq uint64
	httpClient = &http.Client{}
	go client.Subscribe("msg", func(msg *sse.Event) {
		msgType := string([]byte(msg.Event))
		if msgType == "msg" {
			var incomingMsgContent IncomingMessage
			json.Unmarshal([]byte(msg.Data), &incomingMsgContent)
			atomic.StoreUint64(&maxSeq, incomingMsgContent.SeqID)
			fmt.Printf("%v: %v\n", myDeviceId, maxSeq)
		} else {
			messageReceived <- 1
		}
	})

	// Wait for otkeys message
	<-messageReceived


	tick := time.Tick(5 * time.Second)

	for {
		select {
		case <-tick:
			delete(atomic.LoadUint64(&maxSeq))
		// default:
		}

	}
}
