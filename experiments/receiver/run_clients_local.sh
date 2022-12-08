#!/bin/bash

nclients=$1
name=$2
server=$3
startID=$((${4}))

for (( id=0; id<$nclients; id++ ))
do
        # taskset -c $(($id % $NPROCS))
        ./receiver ${name}_$((${id} + ${startID})) $server &
done
wait
