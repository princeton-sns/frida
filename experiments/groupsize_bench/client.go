package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
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
	Sender  string         `json:"sender"`
	//Payload BodyWithCseqID `json:"encPayload"`
	SeqID uint64 `json:"seqID"`
}

type Batch struct {
	Batch []OutgoingMessage `json:"batch"`
}


var deviceId string

var serverAddr string = "http://localhost:8080"

var msgSize int64

var msgContent string

var recvCount uint64 = 0

var duration int64

var keepout int64

var startTime int64

var httpClient *http.Client

var receiver_prefix string

var receiver_low int64
var receiver_high int64

var numHead uint64
var numTail uint64

// var semDelete make(chan bool MAX_ROUTINES_DELETE);

func req(reqType string, jsonStr []byte, path string) *http.Response {
	req, _ := http.NewRequest(reqType, serverAddr+path, bytes.NewBuffer(jsonStr))
	req.Header = http.Header{
		"Content-Type":  {"application/json"},
		"Authorization": {"Bearer " + deviceId},
	}
	resp, err := httpClient.Do(req)
	defer resp.Body.Close()

	if err != nil {
		panic(err)
	}

	ioutil.ReadAll(resp.Body)
	return resp
}

func sendTo(ids []string, cseqID uint64) {
	batch := new(Batch)
	for _, id := range ids {
		body := msgContent
		msg := OutgoingMessage{id, body}
		batch.Batch = append(batch.Batch, msg)
	}
	b, _ := json.Marshal(batch)
	req("POST", b, "/message")
	// defer resp.Body.Close()
	
}

func delete(seqID uint64) {
	delMsg := fmt.Sprintf(`{"seqID" : %v }`, seqID)
	req("DELETE", []byte(delMsg), "/self/messages")
}

func now() int64 {
	return time.Now().UnixNano() / int64(time.Microsecond)
}

func readParams(){
	deviceId = os.Args[1]
	
	if len(os.Args) < 3 {
		duration = 3
	} else {
		duration, _ = strconv.ParseInt(os.Args[2], 10, 0)
	}

	if len(os.Args) < 4 {
		keepout = 1
	} else {
		keepout, _ = strconv.ParseInt(os.Args[3], 10, 0)
	}

	if len(os.Args) < 5 {
		msgSize = 32
	} else {
		msgSize, _ = strconv.ParseInt(os.Args[4], 10, 0)
	}

	if len(os.Args) < 6 {
		serverAddr = "http://localhost:8080"
	} else {
		serverAddr = os.Args[5]
	}

	if len(os.Args) < 7 {
		receiver_prefix = "receiver"
	} else {
		serverAddr = os.Args[6]
	}

	if len(os.Args) < 8 {
		receiver_low = 0
	} else {
		receiver_low, _ = strconv.ParseInt(os.Args[7], 10, 0)
	}

	if len(os.Args) < 9 {
		receiver_high = 10
	} else {
		receiver_high, _ = strconv.ParseInt(os.Args[8], 10, 0)
	}
}

func main() {
	readParams()
	client := sse.NewClient(serverAddr + "/events")
	client.Headers["Authorization"] = "Bearer " + deviceId

	msgContent = string(make([]byte, msgSize))

	messageReceived := make(chan int, 1000)
	var maxSeq uint64
	httpClient = &http.Client{}
	go client.Subscribe("msg", func(msg *sse.Event) {
		msgType := string([]byte(msg.Event))
		if msgType == "msg" {
			var incomingMsgContent IncomingMessage
			json.Unmarshal([]byte(msg.Data), &incomingMsgContent)
			if(incomingMsgContent.Sender == deviceId){
				atomic.AddUint64(&recvCount, 1)
				messageReceived <- 1
			}
			atomic.StoreUint64(&maxSeq, incomingMsgContent.SeqID)
		} else {
			messageReceived <- 1
		}
	})

	// Wait for otkeys message
	<-messageReceived

	listToSend := make([]string, 0)
	for i := receiver_low; i <= receiver_high; i++ {
		rname := fmt.Sprintf("%s_%v", receiver_prefix, i)
		listToSend = append(listToSend, rname)
	} 

	listToSend = append(listToSend, deviceId)

	var id uint64

	startTime = now()

	timerHead := time.NewTimer(time.Duration(keepout) * time.Second)
	timerTail := time.NewTimer(time.Duration(duration-keepout) * time.Second)

	go func() {
		<-timerHead.C
		numHead = atomic.LoadUint64(&recvCount) 
	}()

	tick := time.Tick(10 * time.Second)

	for {
		select {
		case <-timerTail.C:
			numTail = atomic.LoadUint64(&recvCount)
			local_throughput := float32(numTail - numHead)/float32(duration - 2 * keepout)
			fmt.Printf("%v, %v\n", deviceId, local_throughput)
			delete(maxSeq)
			return
		case <-tick:
			delete(atomic.LoadUint64(&maxSeq))
		default:
			sendTo(listToSend, id)
			<-messageReceived
		}
	}
}
