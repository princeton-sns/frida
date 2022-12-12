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
	// "net"
	// "syscall"
    // "golang.org/x/sys/unix"
)

type OutgoingMessage struct {
	DeviceId string `json:"deviceId"`
	Payload  string `json:"payload"`
}

type IncomingMessage struct {
	// Sender  string         `json:"sender"`
	// Payload BodyWithTimestamp `json:"encPayload"`
	SeqID uint64 `json:"seqID"`
}

type Batch struct {
	Batch []OutgoingMessage `json:"batch"`
}

type BodyWithTimestamp struct {
	Body   string `json:"body"`
	Timestamp time.Time `json:"timestamp"`
}

// type NeedsOneTimeKeyEvent struct {
// 	DeviceId string `json:"deviceId"`
// 	Needs    uint `json:"needs"`
// }


var myDeviceId string

var serverAddr string = "http://localhost:8080"

var msgSize int64

var msgContent string

// var recvCount uint64 = 0

var duration int64

var keepout int64

var httpClient_send *http.Client

// var record bool = false;

// var numHead uint64
// var numTail uint64

var latencies [] int64;

var msgPerSecond int64;

var startRec int64;

var sendTimestamp time.Time

var batchContent []byte

func req(reqType string, jsonStr []byte, path string) time.Time {
	// fmt.Printf("Send+++++++++++++++++++++++++\n%v\n", string(jsonStr))
	req, _ := http.NewRequest(reqType, serverAddr+path, bytes.NewBuffer(jsonStr))
	req.Header = http.Header{
		"Content-Type":  {"application/json"},
		"Authorization": {"Bearer " + myDeviceId},
	}
	send_time := now()
	resp, err := httpClient_send.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	ioutil.ReadAll(resp.Body)
	return send_time
}

func send() time.Time {
	// batch := new(Batch)
	// for _, id := range ids {
	// 	// body := BodyWithTimestamp{msgContent, timestamp}
	// 	body := msgContent
	// 	msg := OutgoingMessage{id, body}
	// 	batch.Batch = append(batch.Batch, msg)
	// }
	// b, _ := json.Marshal(batch)
	send_time := req("POST", batchContent, "/message")
	return send_time
	// defer resp.Body.Close()

}

func delete(seqID uint64) {
	delMsg := fmt.Sprintf(`{"seqID" : %v }`, seqID)
	req("DELETE", []byte(delMsg), "/self/messages")
}

func now() time.Time {
	return time.Now()
}

func readParams(){
	myDeviceId = os.Args[1]
	
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

}

func main() {
	readParams()
	client := sse.NewClient(serverAddr + "/events")
	client.Headers["Authorization"] = "Bearer " + myDeviceId

	msgContent = string(make([]byte, msgSize))

	messageReceived := make(chan int, 1000)
	latenciesMeasured := make(chan int64, 1000)

	var maxSeq uint64

	httpClient_send = &http.Client{}

	go client.Subscribe("msg", func(msg *sse.Event) {
		recvTimestamp := now()
		msgType := string([]byte(msg.Event))

		// First message is otkeys
		messageReceived <- 1

		if msgType == "msg" {
			// atomic.AddUint64(&recvCount, 1)
			var incomingMsgContent IncomingMessage
			json.Unmarshal([]byte(msg.Data), &incomingMsgContent)
			atomic.StoreUint64(&maxSeq, incomingMsgContent.SeqID)

			if(atomic.LoadInt64(&startRec) == 1){
				// latency :=  recvTimestamp.Sub(incomingMsgContent.Payload.Timestamp).Microseconds()
				latency :=  recvTimestamp.Sub(sendTimestamp).Microseconds()
				latenciesMeasured <- latency
			}
		}
	})

	// otkeys message
	<-messageReceived

	listToSend := []string{myDeviceId}

	var batchBuffer bytes.Buffer
	batchBuffer.WriteByte(uint8(len(listToSend)))
	for _, id := range listToSend {
		batchBuffer.WriteByte(uint8(len(id)))
		batchBuffer.WriteString(id)

		batchBuffer.WriteByte(uint8(len(msgContent)))
		batchBuffer.WriteString(msgContent)
	}
	batchContent = batchBuffer.Bytes()

	timerHead := time.NewTimer(time.Duration(keepout) * time.Second)
	timerTail := time.NewTimer(time.Duration(duration-keepout) * time.Second)
	timerEnd := time.NewTimer(time.Duration(duration) * time.Second)

	atomic.StoreInt64(&startRec, 0)

	// deleteTick := time.Tick(10 * time.Second)


	
	for {
		select {
		case <-timerHead.C:
			atomic.StoreInt64(&startRec, 1)
		case <-timerTail.C:
			atomic.StoreInt64(&startRec, 0)
		case <-timerEnd.C:
			for _, lat := range latencies{
				fmt.Printf("%v\n", lat)
			}
			delete(atomic.LoadUint64(&maxSeq))
			return
		// case <-deleteTick:
		// 	delete(atomic.LoadUint64(&maxSeq))
		case latency := <-latenciesMeasured:
			latencies = append(latencies, latency)
		default:
			sendTimestamp = send()
			<-messageReceived
		}
	}
}
