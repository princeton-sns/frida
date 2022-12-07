#!/bin/bash

nclients=$1
name=$2
duration=$3
keepout=$4
datasize=$5
server=$6
# NPROCS="$(nproc --all)"
mkdir -p /exp_results

for (( id=0; id<$nclients; id++ ))
do
        # taskset -c $(($id % $NPROCS))
        ./client ${name}_${id} $duration $keepout $datasize $server | tee /exp_results/throughput_${name}_${id} &
done
wait