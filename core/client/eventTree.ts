class EventTree {
  // Current local sequence number to be assigned to a new incoming event
  localSeqCounter: number = 0;

  // Set of events managed within the EventTree
  eventMap: Map<
    string,
    {
      localSeq: number;
      dependencies: string[];
      revDependencies: string[];
    }
  > = new Map();

  // Current root nodes of the tree
  roots: Set<string> = new Set();

  // Current leaf nodes of the tree
  leafs: Set<string> = new Set();

  // Set of known event IDs of devices. That is, all (transitive) dependencies
  // ever included in an event sent by this device are maintained in this list,
  // except for events older than the deviceKnownIDsBound entry of the node:
  deviceKnownEvents: Map<string, Set<number>> = new Map();

  // Insert an event based on its hash, along with a list of dependent
  // events. This function must be called in the order of events.
  //
  // It will validate that all dependent events for a given event are present in
  // the tree and insert it if it does, otherwise return false.
  //
  // The `eventHash` must be a hash over the event, including its ordered
  // dependencies specification.
  insertEvent(
    eventHash: string,
    dependencies: string[],
    deviceId: string,
    ourDeviceId: string
  ): boolean {
    // If we already know of this event hash, reject it:
    if (this.eventMap.has(eventHash)) {
      return false;
    }

    // For all dependencies, ensure that
    // 1. we hold this dependency event in our (pruned) DAG. We only prune
    //    events to which correctly implemented devices will never make a
    //    reference to.
    // 2. dependencies are in the order in which we've received them
    // 3. it does not collide with the eventHash, to retain the acyclic nature
    //    of the graph
    let currentSeq = 0;
    for (let dep in dependencies) {
      let depEntry = this.eventMap.get(dep);

      // Check if we have a local version of this dependency:
      if (depEntry === undefined) {
        return false;
      }

      // Check whether it is in order with the other dependencies:
      if (depEntry.localSeq >= currentSeq) {
        currentSeq = depEntry.localSeq;
      } else {
        return false;
      }
    }

    // The event is valid, insert it into the tree:
    let assignedEventSeqNo = this.localSeqCounter;
    this.localSeqCounter += 1;
    this.eventMap.set(eventHash, {
      localSeq: assignedEventSeqNo,
      dependencies: dependencies,
      revDependencies: [],
    });

    // Propagate the reverse dependencies:
    for (let dep in dependencies) {
      let depEvent = this.eventMap.get(dep) as { revDependencies: string[] };
      depEvent.revDependencies.push(eventHash);
    }

    // If this event does not have a any dependencies, add it as a new tree
    // node:
    if (dependencies.length == 0) {
      this.roots.add(eventHash);
    }

    // If a current leaf node in our tree is a dependency of this event, we can
    // remove it as a leaf. This is because this current event will become a new
    // leaf of the tree:
    for (let dep in dependencies) {
      this.leafs.delete(dep);
    }

    // Add this event to the tree leaf
    this.leafs.add(eventHash);

    // Now the tree is consistent. Add the event, including all of its
    // transitive dependencies, to the device's seen events:
    // TODO: check this beforehand and abort early!
    if (!this.deviceKnownEvents.has(deviceId)) {
      this.deviceKnownEvents.set(deviceId, new Set());
    }
    let deviceKnownEvents = this.deviceKnownEvents.get(deviceId) as Set<number>;

    let outstandingEvents: string[] = [eventHash];
    while (outstandingEvents.length > 0) {
      // Process one event of the set of outstanding events:
      let event = this.eventMap.get(outstandingEvents.pop() as string) as {
        localSeq: number;
        dependencies: string[];
      };

      // Resolve the event local sequence number:
      let eventSeqNo = event.localSeq;

      // If this event is known to the device, don't further process it.  All
      // further transitive dependencies must've also been seen by this device.
      if (deviceKnownEvents.has(eventSeqNo)) {
        continue;
      }

      // The currently processed event has been determined to be a (transitive)
      // dependency of the received event, and hence it must also be known to
      // the device:
      deviceKnownEvents.add(eventSeqNo);

      // Continue processing the depenencies the dependencies of this event:
      outstandingEvents = outstandingEvents.concat(event.dependencies);
    }

    // Also, we ourselves naturally also know of this event:
    if (!this.deviceKnownEvents.has(ourDeviceId)) {
      this.deviceKnownEvents.set(ourDeviceId, new Set());
    }
    let ourDeviceKnownEvents = this.deviceKnownEvents.get(
      deviceId
    ) as Set<number>;
    ourDeviceKnownEvents.add(assignedEventSeqNo);

    // Now that we know which devices know of which events, we can prune the
    // tree:
    this.pruneTree();

    return false;
  }

  // To ensure that we don't prune tree events which may still be referenced by
  // devices newly added to a group, call this method as soon as an event is
  // received which adds a new device to a group. It is important that the new
  // device does not see any events prior to this, as we might prune prior
  // events without the device acknowledging these.
  addDevice(deviceId: string) {
    if (!this.deviceKnownEvents.has(deviceId)) {
      this.deviceKnownEvents.set(deviceId, new Set());
    }
  }

  deviceKnowsEventSeqNo(deviceId: string, eventSeqNo: number): boolean {
    let deviceKnownEvents = this.deviceKnownEvents.get(deviceId);
    if (deviceKnownEvents === undefined) {
      return false;
    } else {
      return deviceKnownEvents.has(eventSeqNo);
    }
  }

  deviceKnowsEvent(deviceId: string, eventHash: string): boolean {
    let event = this.eventMap.get(eventHash);
    if (event === undefined) {
      return false;
    } else {
      return this.deviceKnowsEventSeqNo(deviceId, event.localSeq);
    }
  }

  allDevicesKnowEvent(eventHash: string): boolean {
    for (let deviceId in this.deviceKnownEvents.keys()) {
      if (!this.deviceKnowsEvent(deviceId, eventHash)) {
        return false;
      }
    }

    return true;
  }

  pruneTree(): void {
    // Start at the roots of the tree:
    let pendingRoots: Set<string> = new Set(this.roots);

    // Iterate through the roots and try to move them down:
    while (pendingRoots.size > 0) {
      // Pop one root and process it:
      let rootEventHash: string = pendingRoots.values().next().value;
      pendingRoots.delete(rootEventHash);
      let rootEvent = this.eventMap.get(rootEventHash) as {
        revDependencies: string[];
        localSeq: number;
      };

      // If a given event has a set of reverse-dependencies, where each device
      // knows of at least one of these reverse dependencies, then we can
      // remove it from the tree given it will never be referenced any more:
      let remainDevices = new Set(this.deviceKnownEvents.keys());
      for (let revDepHash in rootEvent.revDependencies) {
        let revDep = this.eventMap.get(revDepHash) as { localSeq: number };

        for (let devId in remainDevices) {
          if (this.deviceKnowsEventSeqNo(devId, revDep.localSeq)) {
            remainDevices.delete(devId);
          }
        }

        if (remainDevices.size === 0) {
          break;
        }
      }

      // If the event does not have reverse-dependencies known by all devices,
      // it may still be referenced. Hence we can't delete it.
      if (remainDevices.size !== 0) {
        continue;
      }

      // The event has reverse-dependencies which are known by all devices, we
      // can remove it. For each such reverse-dependency, if the node we're
      // removing is the only path to a current root (meaning that a current
      // root is in its set of dependencies, and it is the only event we hold
      // which is in that root's reverse dependencies), promote this node to a
      // new root:
      for (let revDepHash in rootEvent.revDependencies) {
        let revDep = this.eventMap.get(revDepHash) as {
          dependencies: string[];
        };

        let hasPathToOtherRoot = false;
        for (let revDepDepHash in revDep.dependencies) {
          if (hasPathToOtherRoot) {
            break;
          }

          if (
            this.roots.has(revDepDepHash)
            && revDepDepHash !== rootEventHash
          ) {
            let revDepDepRoot = this.eventMap.get(revDepDepHash) as {
              revDependencies: string[];
            };
            for (let revDepDepRootRevDepHash in revDepDepRoot.revDependencies) {
              if (
                this.eventMap.has(revDepDepRootRevDepHash)
                && revDepHash !== revDepDepRootRevDepHash
              ) {
                hasPathToOtherRoot = true;
                break;
              }
            }
          }
        }

        if (!hasPathToOtherRoot) {
          // The reverse-dependency of the root we're removing has no
          // other path to a root, promote it to a new root:
          this.roots.add(revDepHash);
          pendingRoots.add(revDepHash);
        }
      }

      // Finally, remove the event:
      this.roots.delete(rootEventHash);
      this.eventMap.delete(rootEventHash);
    }
  }
}
