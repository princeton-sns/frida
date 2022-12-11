package main

import (
	"bytes"
	"encoding/json"
	"fmt"
<<<<<<< HEAD
||||||| f2f2882
	"io/ioutil"
	"math/rand"
=======
	"io/ioutil"
	// "math/rand"
>>>>>>> config-app-testing
	"net/http"
	"os"
	"strconv"
	"sync/atomic"
	"time"
	"io/ioutil"
	"github.com/r3labs/sse/v2"
	// "math/rand"
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


var myDeviceId string

var serverAddr string = "http://localhost:8080"

var msgSize int64

var msgContent string

var batchContent []byte

var recvCount uint64 = 0

var duration int64

var keepout int64

var startTime int64

var httpClient *http.Client

// var receiverPrefix string

var numHead uint64
var numTail uint64

<<<<<<< HEAD
var groupSize int64;
var waitrecv int64;
||||||| f2f2882
var groupSize int64
var independent int64

=======
var groupSize int64
// var independent int64

>>>>>>> config-app-testing
// var semDelete make(chan bool MAX_ROUTINES_DELETE);

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

// func sendTo(ids []string) {
func send() {
	// batch := new(Batch)
	// for _, id := range ids {
	// 	body := msgContent
	// 	msg := OutgoingMessage{id, body}
	// 	batch.Batch = append(batch.Batch, msg)
	// }
	// b, _ := json.Marshal(batch)
	req("POST", batchContent, "/message")
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

	if len(os.Args) < 7 {
		groupSize = 1
	} else {
		groupSize, _ = strconv.ParseInt(os.Args[6], 10, 0)
	}

	// if len(os.Args) < 7 {
	// 	receiverPrefix = "receiver"
	// } else {
	// 	receiverPrefix = os.Args[6]
	// }

	// if len(os.Args) < 9 {
	// 	independent = 1
	// } else {
	// 	independent, _ = strconv.ParseInt(os.Args[8], 10, 0)
	// }

}

func main() {
	readParams()

	client := sse.NewClient(serverAddr + "/events")
	client.Headers["Authorization"] = "Bearer " + myDeviceId
	msgContent = string(make([]byte, msgSize))

	messageReceived := make(chan int, 1000)
	var maxSeq uint64
	httpClient = &http.Client{}

	go client.Subscribe("msg", func(msg *sse.Event) {
		atomic.AddUint64(&recvCount, 1)
		msgType := string([]byte(msg.Event))
		if msgType == "msg" {
			if(waitrecv > 0){
				messageReceived <- 1
			}
			var incomingMsgContent IncomingMessage
			json.Unmarshal([]byte(msg.Data), &incomingMsgContent)
			atomic.StoreUint64(&maxSeq, incomingMsgContent.SeqID)
		} 
		else {
			For otkeys message
			messageReceived <- 1
		}
	})

	// Not doing anything, just let go not panic including rand, which keeps vender hash in Nix!
	// tmp := rand.Intn(100)

	// Wait for otkeys message
	<-messageReceived
	listToSend := make([]string, 0)
	allClientList := make([]string, 0)
	for i := int64(0); i < groupSize-1; i++ {
		// rname := fmt.Sprintf("%s_%s_%v", myDeviceId, receiverPrefix, i)
		rname := fmt.Sprintf("%s_%v", myDeviceId, i)
		allClientList = append(allClientList, rname)
	} 

	// if independent == 0 {
	// 	rand.Seed(time.Now().UnixNano())
	// 	allClientList = remove(allClientList, myDeviceId)
	// 	for i := int64(0); i < groupSize-1; i++ {
	// 		randomDeviceId := allClientList[rand.Intn(len(allClientList))]
	// 		listToSend = append(listToSend, randomDeviceId)
	// 		allClientList = remove(allClientList, randomDeviceId)
	// 	}
	// } else {
	listToSend = allClientList
	// }
	listToSend = append(listToSend, myDeviceId)
	// fmt.Printf("%v\n", listToSend)

	var batchBuffer bytes.Buffer
	batchBuffer.WriteByte(uint8(len(listToSend)))
	for _, id := range listToSend {
		batchBuffer.WriteByte(uint8(len(id)))
		batchBuffer.WriteString(id)

		batchBuffer.WriteByte(uint8(len(msgContent)))
		batchBuffer.WriteString(msgContent)
	}
	batchContent = batchBuffer.Bytes()

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
			localThroughput := float32(numTail - numHead)/float32(duration - 2*keepout)
			fmt.Printf("%v\n", localThroughput)
			delete(maxSeq)
			return
		case <-tick:
			delete(atomic.LoadUint64(&maxSeq))
		default:
			send()
			if(waitrecv > 0){
				<-messageReceived
			}
		}
	}
}
