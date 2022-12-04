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
	//Sender  string         `json:"sender"`
	//Payload BodyWithCseqID `json:"encPayload"`
	SeqID uint64 `json:"seqID"`
}

type Batch struct {
	Batch []OutgoingMessage `json:"batch"`
}

type BodyWithCseqID struct {
	Body   string `json:"body"`
	CseqID uint64 `json:"cseqID"`
}

// type NeedsOneTimeKeyEvent struct {
// 	DeviceId string `json:"deviceId"`
// 	Needs    uint `json:"needs"`
// }

const MAX_ROUTINES_SEND = 2

// const MAX_ROUTINES_DELETE = 2

var deviceId string

var serverAddr string = "http://localhost:8080"

var msgSize int64

var msgContent string

var recvCount uint64 = 0

var duration int64

var keepout int64

var httpClient *http.Client

// var record bool = false;

var numHead uint64
var numTail uint64

var latencies []int64;

var msgPerSecond int64;

var startRec int64;

var sendTimestamp int64;

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
	resp := req("POST", b, "/message")
	defer resp.Body.Close()
}

func delete(seqID uint64) {
	delMsg := fmt.Sprintf(`{"seqID" : %v }`, seqID)
	req("DELETE", []byte(delMsg), "/self/messages")
}

func now() int64 {
	return time.Now().UnixNano() / int64(time.Microsecond)
}

func main() {
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
		msgPerSecond = 5
	} else {
		msgPerSecond, _ = strconv.ParseInt(os.Args[6], 10, 0)
	}
	
	client := sse.NewClient(serverAddr + "/events")
	client.Headers["Authorization"] = "Bearer " + deviceId

	msgContent = string(make([]byte, msgSize))

	messageReceived := make(chan int, 1000)
	var maxSeq uint64
	httpClient = &http.Client{}
	go client.Subscribe("msg", func(msg *sse.Event) {
		if(atomic.LoadInt64(&startRec) == 1){
			latencies = append(latencies, now() - atomic.LoadInt64(&sendTimestamp))
		}
		messageReceived <- 1
		atomic.AddUint64(&recvCount, 1)
		msgType := string([]byte(msg.Event))
		if msgType == "msg" {
			var incomingMsgContent IncomingMessage
			json.Unmarshal([]byte(msg.Data), &incomingMsgContent)
			atomic.StoreUint64(&maxSeq, incomingMsgContent.SeqID)
		}
	})

	listToSend := []string{deviceId}

	var id uint64


	timerHead := time.NewTimer(time.Duration(keepout) * time.Second)
	timerTail := time.NewTimer(time.Duration(duration-keepout) * time.Second)

	// go func() {
	// 	<-timerHead.C
	// 	numHead = atomic.AddUint64(&recvCount, 1)
	// }()
	atomic.StoreInt64(&startRec, 0)
	delete_tick := time.Tick(10 * time.Second)

	send_tick := time.Tick((time.Duration(1000000 / msgPerSecond)) * time.Microsecond)

	for {
		select {
		case <- timerHead.C:
			numHead = atomic.AddUint64(&recvCount, 1)
			atomic.StoreInt64(&startRec, 1)
		case <-timerTail.C:
			atomic.StoreInt64(&startRec, 0)
			numTail = (atomic.AddUint64(&recvCount, 1) - 1) - numHead
			var sum int64 = 0
			for _, lat := range latencies{
				sum += lat
			}

			fmt.Printf("%v, throughput: %v\n", deviceId, float32(numTail)/float32(duration-2*keepout))
			fmt.Printf("%v, latency: %v\n", deviceId, float32(sum)/float32(len(latencies)))
			delete(maxSeq)
			return
		case <-delete_tick:
			delete(atomic.LoadUint64(&maxSeq))
		// default:
		case <-send_tick:
			atomic.StoreInt64(&sendTimestamp, now())
			sendTo(listToSend, id)
			<-messageReceived
		}
	}
}
