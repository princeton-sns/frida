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

const MAX_ROUTINES_SEND = 2

// const MAX_ROUTINES_DELETE = 2

var deviceId string

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

func req(reqType string, jsonStr []byte, path string) time.Time {
	// fmt.Printf("Send+++++++++++++++++++++++++\n%v\n", string(jsonStr))
	req, _ := http.NewRequest(reqType, serverAddr+path, bytes.NewBuffer(jsonStr))
	req.Header = http.Header{
		"Content-Type":  {"application/json"},
		"Authorization": {"Bearer " + deviceId},
	}
	send_time := now()
	resp, err := httpClient_send.Do(req)
	defer resp.Body.Close()

	if err != nil {
		panic(err)
	}

	ioutil.ReadAll(resp.Body)
	return send_time
}

func sendTo(ids []string) time.Time {
	batch := new(Batch)
	for _, id := range ids {
		// body := BodyWithTimestamp{msgContent, timestamp}
		body := msgContent
		msg := OutgoingMessage{id, body}
		batch.Batch = append(batch.Batch, msg)
	}
	b, _ := json.Marshal(batch)
	send_time := req("POST", b, "/message")
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

	// if len(os.Args) < 7 {
	// 	msgPerSecond = 5
	// } else {
	// 	msgPerSecond, _ = strconv.ParseInt(os.Args[6], 10, 0)
	// }
}

func main() {
	readParams()
	client := sse.NewClient(serverAddr + "/events")
	client.Headers["Authorization"] = "Bearer " + deviceId

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

	listToSend := []string{deviceId}

	timerHead := time.NewTimer(time.Duration(keepout) * time.Second)
	timerTail := time.NewTimer(time.Duration(duration-keepout) * time.Second)

	atomic.StoreInt64(&startRec, 0)

	delete_tick := time.Tick(10 * time.Second)
	// send_tick := time.Tick((time.Duration(1000000 / msgPerSecond)) * time.Microsecond)


	
	for {
		select {
		case <-timerHead.C:
			// numHead = atomic.LoadUint64(&recvCount)
			atomic.StoreInt64(&startRec, 1)
		case <-timerTail.C:
			// numTail = (atomic.LoadUint64(&recvCount))
			atomic.StoreInt64(&startRec, 0)
			// local_throughput := float32(numTail-numHead)/float32(duration-2*keepout)

			// var sum_lat int64 = 0
			for _, lat := range latencies{
				// sum_lat += lat
				fmt.Printf("%v\n", lat)
			}
			// avg_lat_in_ms := (float32(sum_lat) / 1000)/float32(len(latencies))
			// fmt.Println(latencies)
			// fmt.Printf("%v, %v, %v, %v\n", deviceId, local_throughput, avg_lat_in_ms, len(latencies))
			delete(atomic.LoadUint64(&maxSeq))
			return
		case <-delete_tick:
			delete(atomic.LoadUint64(&maxSeq))
		case latency := <-latenciesMeasured:
			latencies = append(latencies, latency)
		// case <-send_tick:
		default:
			sendTimestamp = sendTo(listToSend)
			<-messageReceived
		}
	}
}
