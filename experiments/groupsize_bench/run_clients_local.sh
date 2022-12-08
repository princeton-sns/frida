#!/bin/bash

nclients=$(($1))
name=$2
duration=$(($3))
keepout=$(($4))
datasize=$(($5))
server=$6
receiver_prefix=$7
receiver_low=$(($8))
receiver_high=$(($9))
num_rand=$((${10}))

startID=$((${11}))
mkdir -p ~/exp_results



for (( id=0; id<$nclients; id++ ))
do
        if [ $num_rand -gt 0 ]
        then
                 ./groupclient ${name}_$((${id} + ${startID})) $duration $keepout $datasize $server $receiver_prefix $receiver_low $receiver_high $num_rand
        else
                num_per_sender=$(( ($receiver_high - $receiver_low)/ $nclients ))
                this_sender_low=$(( $receiver_low + $id * $num_per_sender ))
                this_sender_high=$(( $receiver_low + ($id+1) * $num_per_sender))
                ./groupclient ${name}_${id} $duration $keepout $datasize $server $receiver_prefix $this_sender_low $this_sender_high $num_rand1
        fi
        
done
wait