package main

import (
	"fmt"
	"github.com/r3labs/sse/v2"
	"encoding/json"
	"net/http"
	"bytes"
	"time"
	"os"
	"strconv"
)

type OutgoingMessage struct {
	DeviceId string `json:"deviceId"`
	Payload  interface{} `json:"payload"`
}

type IncomingMessage struct {
	Sender   string `json:"sender"`
	Payload  interface{} `json:"encPayload"`
	SeqID    uint64 `json:"seqID"`
}


type Batch struct {
	Batch [] OutgoingMessage `json:"batch"`
}

type BodyWithCseqID struct {
	Body interface{} `json:"body"`
	CseqID uint64 `json:"cseqID"`
}

// type NeedsOneTimeKeyEvent struct {
// 	DeviceId string `json:"deviceId"`
// 	Needs    uint `json:"needs"`
// }

const MAX_ROUTINES_SEND = 2

var deviceId string;

var serverAddr string = "http://localhost:8080";

var msgSize = 64;

var msgContent []byte;

var recvCount uint64 = 0;

var duration int64;

var keepout int64 = 1;

var startTime int64;

var httpClient *http.Client;

var record bool = false;

var numHead uint64;
var numTail uint64;

func req(reqType string, jsonStr []byte, path string) (*http.Response){
	req, _ := http.NewRequest(reqType, serverAddr + path, bytes.NewBuffer(jsonStr))
	req.Close = true
	req.Header = http.Header{
		"Content-Type": {"application/json"},
		"Authorization": {"Bearer " + deviceId},
	}
	resp, err := httpClient.Do(req)

	if err != nil {
        panic(err)
    }
	return resp
}

func sendTo(ids []string, cseqID uint64){
	batch := new(Batch)
	for _, id := range ids{
		body := BodyWithCseqID{msgContent, cseqID}
		msg := OutgoingMessage{id, body}
		batch.Batch = append(batch.Batch, msg)
	}
	b, _ := json.Marshal(batch)
	resp := req("POST", b, "/message")
	defer resp.Body.Close()
}

func delete(seqID uint64){
	delMsg := fmt.Sprintf(`{"seqID" : %v }`, seqID)
	req("DELETE", []byte(delMsg), "/self/messages")
}

func now() int64 {
    return time.Now().UnixNano() / int64(time.Microsecond)
}

func main() {
	deviceId = os.Args[1]
	duration , _ = strconv.ParseInt(os.Args[2], 10, 0)
	keepout , _ = strconv.ParseInt(os.Args[3], 10, 0)
	client := sse.NewClient(serverAddr + "/events")
	client.Headers["Authorization"] = "Bearer " + deviceId

	msgContent = make([]byte, msgSize)

	// finish := make(chan bool)
	httpClient = &http.Client{}
	go client.Subscribe("msg", func(msg *sse.Event) {
		recvCount += 1
		
		// if(msgType == "otkey"){
			// var msgContent NeedsOneTimeKeyEvent
			// json.Unmarshal([]byte(msg.Data), &msgContent)
			// fmt.Println(msgContent.DeviceId)
		// }
		func(){
			msgType := string([]byte(msg.Event))
			if(msgType == "msg"){
				var msgContent IncomingMessage
				json.Unmarshal([]byte(msg.Data), &msgContent)
				delete(msgContent.SeqID)
			}
		}()
	})
	

	listToSend := []string{deviceId}

	var i uint64

	sem := make(chan int, MAX_ROUTINES_SEND)

	startTime = now()

	timerHead := time.NewTimer(time.Duration(keepout) * time.Second)
	timerTail := time.NewTimer(time.Duration(duration - keepout) * time.Second)

	go func(){
		<-timerHead.C
		numHead = recvCount
	}()

	go func(){
		<-timerTail.C
		numTail = recvCount - numHead
		fmt.Printf("%v : %v\n", deviceId, numTail)
	}()

	for i = 0; (now() - startTime <= duration * 1000000); i++ {
		sem <- 1
		go func(id uint64){
			// fmt.Printf("send time[%v]: %v\n", id, now())
			sendTo(listToSend, id)
			<-sem
		}(i)
	}
	// <-finish
	for ;recvCount <= i ;{}
	// fmt.Printf("%v, %v\n", recvCount, i)
}
