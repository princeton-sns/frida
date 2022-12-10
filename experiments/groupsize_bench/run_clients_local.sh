#!/bin/bash

nclients=$(($1))
name=$2
duration=$(($3))
keepout=$(($4))
datasize=$(($5))
server=$6
receiver_prefix=$7
group_size=$(($8))
waitrecv=$((${9}))

for (( id=0; id<$nclients; id++ ))
do
        ./groupsize-bench-client ${name}_${id} $duration $keepout $datasize $server ${name}_${id} $group_size $waitrecv &       
done
wait
