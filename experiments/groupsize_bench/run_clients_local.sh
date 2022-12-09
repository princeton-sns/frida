#!/bin/bash

nclients=$(($1))
name=$2
duration=$(($3))
keepout=$(($4))
datasize=$(($5))
server=$6
receiver_prefix=$7
group_size=$(($8))
independent=$((${9}))
startID=$((${10}))
mkdir -p ~/exp_results

for (( id=0; id<$nclients; id++ ))
do
        if [ $independent -gt 0 ]
        then
                 ./groupclient ${name}_${id} $duration $keepout $datasize $server ${name}_${id} $group_size $independent &
        else
                ./groupclient ${name}_$((${id} + ${startID})) $duration $keepout $datasize $server $receiver_prefix $group_size $independent &
        fi
        
done
wait
