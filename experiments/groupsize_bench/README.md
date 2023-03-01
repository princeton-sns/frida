# groupsize bench

```sh
go build client.go
```

Generates an executable that the following script runs.

Command arguments: 

```sh
./run_clients_local.sh [num_clients] [name] [duration (s)] [keepout (s)] [datasize (bytes)] [server (full address)] [group_size]
```

Example command:

```sh
./run_clients_local.sh 1 groupsize_client 5 1 5 http://localhost:8080 2
```
