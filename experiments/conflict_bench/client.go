package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	// "math/rand"
	"net/http"
	"os"
	"strconv"
	"sync/atomic"
	"time"
	"bufio"
	"github.com/r3labs/sse/v2"
	"sync"
)

type OutgoingMessage struct {
	DeviceId string `json:"deviceId"`
	Payload  string `json:"payload"`
}

type IncomingMessage struct {
	// Sender  string         `json:"sender"`
	//Payload BodyWithCseqID `json:"encPayload"`
	SeqID uint64 `json:"seqID"`
}

type Batch struct {
	Batch []OutgoingMessage `json:"batch"`
}

func remove(arr []string, str string) []string {
	for i, element := range arr {
		if element == str {
			return append(arr[:i], arr[i+1:]...)
		}
	}
	return arr
}

var deviceIdPrefix string

var serverAddr string = "http://localhost:8080"

var msgSize int64

var numClients int64

var duration int64

var keepout int64

var groupSize int64

var wg sync.WaitGroup

func req(reqType string, jsonStr []byte, path string, client *http.Client, deviceId string) *http.Response {
	req, _ := http.NewRequest(reqType, serverAddr+path, bytes.NewBuffer(jsonStr))
	req.Header = http.Header{
		"Content-Type":  {"application/json"},
		"Authorization": {"Bearer " + deviceId},
	}
	resp, err := client.Do(req)

	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	ioutil.ReadAll(resp.Body)
	return resp
}

func send(batchContent []byte, client *http.Client, deviceId string) {
	// fmt.Printf("%s: send %v\n", deviceId, string(batchContent))
	req("POST", batchContent, "/message", client, deviceId)
}

func delete(seqID uint64,  client *http.Client, deviceId string) {
	delMsg := fmt.Sprintf(`{"seqID" : %v }`, seqID)
	req("DELETE", []byte(delMsg), "/self/messages",  client, deviceId)
}

func now() int64 {
	return time.Now().UnixNano() / int64(time.Microsecond)
}

func readParams() {

	if len(os.Args) < 2 {
		numClients = 1
	} else {
		numClients, _ = strconv.ParseInt(os.Args[1], 10, 0)
	}

	deviceIdPrefix = os.Args[2]

	if len(os.Args) < 4 {
		duration = 3
	} else {
		duration, _ = strconv.ParseInt(os.Args[3], 10, 0)
	}

	if len(os.Args) < 5{
		keepout = 1
	} else {
		keepout, _ = strconv.ParseInt(os.Args[4], 10, 0)
	}

	if len(os.Args) < 6 {
		msgSize = 32
	} else {
		msgSize, _ = strconv.ParseInt(os.Args[5], 10, 0)
	}

	if len(os.Args) < 7 {
		serverAddr = "http://localhost:8080"
	} else {
		serverAddr = os.Args[6]
	}

	
	if len(os.Args) < 8 {
		groupSize = 1
	} else {
		groupSize, _ = strconv.ParseInt(os.Args[7], 10, 0)
	}
}

func runClient(id int64, listToSend []string){
	defer wg.Done()
	myDeviceId := fmt.Sprintf("%s_%v", deviceIdPrefix, id)

	client := sse.NewClient(serverAddr + "/events")
	client.Headers["Authorization"] = "Bearer " + myDeviceId

	messageReceived := make(chan int, 1000)
	var maxSeq uint64
	httpClient := &http.Client{}
	listToSend = append(listToSend, myDeviceId)
	var recvCount uint64 = 0
	// fmt.Printf("%s: %v\n", myDeviceId, listToSend)
	// return
	go client.Subscribe("msg", func(msg *sse.Event) {
		messageReceived <- 1
		atomic.AddUint64(&recvCount, 1)
		msgType := string([]byte(msg.Event))
		if msgType == "msg" {
			var incomingMsgContent IncomingMessage
			json.Unmarshal([]byte(msg.Data), &incomingMsgContent)
			atomic.StoreUint64(&maxSeq, incomingMsgContent.SeqID)
		}
	})
	
	// Wait for otkeys message
	<-messageReceived
	// listToSend = receiverLists[id]

	msgContent := string(make([]byte, msgSize))
	var batchBuffer bytes.Buffer
	batchBuffer.WriteByte(uint8(len(listToSend)))
	for _, id := range listToSend {
		batchBuffer.WriteByte(uint8(len(id)))
		batchBuffer.WriteString(id)

		batchBuffer.WriteByte(uint8(len(msgContent)))
		batchBuffer.WriteString(msgContent)
	}
	batchContent := batchBuffer.Bytes()
	var numHead uint64
	var numTail uint64

	timerHead := time.NewTimer(time.Duration(keepout) * time.Second)
	timerTail := time.NewTimer(time.Duration(duration-keepout) * time.Second)
	timerEnd := time.NewTimer(time.Duration(duration) * time.Second)

	//tick := time.Tick(10 * time.Second)

	for {
		select {
		case <-timerHead.C:
			numHead = atomic.LoadUint64(&recvCount)
		case <-timerTail.C:
			numTail = atomic.LoadUint64(&recvCount)
			localThroughput := float32(numTail - numHead)/float32(duration - 2*keepout)
			fmt.Printf("%v\n", localThroughput)
		case <-timerEnd.C:
			delete(maxSeq, httpClient, myDeviceId)
			return
		//case <-tick:
		//delete(atomic.LoadUint64(&maxSeq))
		default:
			send(batchContent, httpClient, myDeviceId)
			<-messageReceived
		}
	}
}

func main() {
	readParams()
	var receiverLists = make([][]string, 0)
	reader := bufio.NewReader(os.Stdin)
	for c := int64(0); c < numClients; c++{
		rlist := make([]string, 0)
		for r:= int64(0); r < groupSize - 1; r++{
			rname,_ := reader.ReadString('\n')	
			rlist = append(rlist, "rec_" + rname)
		}
		receiverLists = append(receiverLists, rlist)
	}	
	
	// fmt.Printf("%v\n", receiverLists)
	http.DefaultTransport.(*http.Transport).MaxIdleConnsPerHost = 300
	wg.Add(int(numClients))
	for i:=int64(0); i < numClients; i++ {
		go runClient(i, receiverLists[i])
	}
	wg.Wait()
}
