use std::collections::{HashMap, HashSet, VecDeque};
use std::hash::Hash;
use std::borrow::Borrow;
use std::fmt::Debug;

// TODO: use an opaque wrapper around the ThinMapIdx which supports the required
// operations, but does not provide access to the underlying index type's raw
// value, like this:
//
// pub struct ThinMapRef<K, I: ThinMapIdx> {
//     key_idx: I,
//     _k: PhantomData<K>,
// }

pub trait ThinMapIdx : Sized + Hash + Eq + Copy {
    fn base() -> Self;
    fn incr(self) -> Self;
}

impl ThinMapIdx for u64 {
    fn base() -> Self {
	0
    }

    fn incr(self) -> Self {
	self.checked_add(1)
	    .expect("ThinMapIdx u64 overflow!")
    }
}

/// Wrapper around a map for efficiently storing values referencing
/// keys. Particularly useful for representing graph-like data
/// structures.
pub struct ThinMap<K: Clone + Eq + Hash, V, I: ThinMapIdx = u64> {
    next_thin_idx: I,
    key_map: HashMap<I, K>,
    main_map: HashMap<K, (I, V)>,
}

impl<K: Clone + Eq + Hash, V, I: ThinMapIdx> ThinMap<K, V, I> {
    pub fn new() -> Self {
	ThinMap {
	    next_thin_idx: I::base(),
	    key_map: HashMap::new(),
	    main_map: HashMap::new(),
	}
    }

    pub fn get<Q: ?Sized>(&self, k: &Q) -> Option<(I, &V)>
        where K: Borrow<Q>,
	      Q: Hash + Eq,
    {
	self.main_map.get(k).map(|(i, v)| (*i, v))
    }

    pub fn get_mut<Q: ?Sized>(&mut self, k: &Q) -> Option<(I, &mut V)>
        where K: Borrow<Q>,
	      Q: Hash + Eq,
    {
	self.main_map.get_mut(k).map(|(i, v)| (*i, v))
    }

    pub fn get_thin(&self, t: &I) -> Option<(&K, &V)> {
	let key = self.key_map.get(t)?;
	self.main_map.get(key).map(|(_, v)| (key, v))
    }

    pub fn get_thin_mut(&mut self, t: &I) -> Option<(&K, &mut V)> {
	let key = self.key_map.get(t)?;
	self.main_map.get_mut(key).map(|(_, v)| (key, v))
    }


    pub fn lookup_thin(&self, t: &I) -> Option<&K> {
	self.key_map.get(t)
    }

    pub fn iter(&self) -> std::collections::hash_map::Iter<'_, K, (I, V)> {
	self.main_map.iter()
    }

    /// Passthrough of [`HashMap::insert`]
    pub fn insert(&mut self, k: K, v: V) -> (I, Option<V>) {
	self.insert_thin(k, |_| v)
    }

    pub fn insert_thin(&mut self, k: K, f: impl FnOnce(I) -> V) -> (I, Option<V>) {
	// Get a new "thin" index:
	let thin_idx: I = self.next_thin_idx;
	self.next_thin_idx = self.next_thin_idx.incr();

	// Determine the value to insert depending on this new thin
	// index and insert it into the map:
	let v = f(thin_idx);
	let prev = self.main_map.insert(k.clone(), (thin_idx, v));

	// Insert the thin index into the map:
	self.key_map.insert(thin_idx, k);

	// If we've just replaced a value from the main map,
	// invalidate its thin index:
	if let Some((prev_i, _)) = prev {
	    self.key_map.remove(&prev_i)
		.expect("ThinMap inconsistency: no thin index for entry");
	}

	(thin_idx, prev.map(|(_, v)| v))
    }

    pub fn contains_key<Q: ?Sized>(&self, k: &Q) -> bool
    where K: Borrow<Q>,
	  Q: Hash + Eq,
    {
	self.main_map.contains_key(k)
    }

    pub fn contains_thin_key(&self, k: &I) -> bool
    {
	self.key_map.contains_key(k)
    }

    pub fn remove<Q: ?Sized>(&mut self, k: &Q) -> Option<(I, V)>
        where K: Borrow<Q>,
	      Q: Hash + Eq,
    {
	self.main_map.remove(k).map(|(i, v)| {
	    assert!(self.key_map.remove(&i).map(|thin_k| assert!(thin_k.borrow() == k)).is_some());
	    (i, v)
	})
    }

    pub fn remove_thin(&mut self, i: &I) -> Option<(K, V)> {
	let k = self.key_map.remove(i)?;
	self.main_map
	    .remove(&k)
	    .map(|(main_i, v)| {
		assert!(*i == main_i);
		(k, v)
	    })
    }
}

impl<K: Clone + Eq + Hash, V, I: ThinMapIdx + Ord> ThinMap<K, V, I> {
    pub fn next_thin_idx(&self) -> I {
	self.next_thin_idx
    }
}


pub enum EventGraphError<H: MessageDigest> {
    ReplayedEvent,
    EventDependencyUnknown,
    EventDependencyOrderMismatch(H, H),
    EventDependencyHashCollision,
}

/// Generic device ID
pub trait DeviceId : Sized + Hash + Eq + Ord + Clone + Debug {}

/// Generic wrapper over a cryptographic message digest
pub trait MessageDigest : Sized + Hash + Eq + Ord + Clone + Debug {}

pub struct EventNode<I: ThinMapIdx> {
    deps: Vec<I>,
    rev_deps: Vec<I>,
}

pub trait EventGraphInspector<D: DeviceId, H: MessageDigest> {
    fn add_graph_vertex(&self, _label: &H) {}
    fn set_graph_vertex_root(&self, _label: &H, _root: bool) {}
    fn set_graph_vertex_leaf(&self, _label: &H, _leaf: bool) {}
    fn add_graph_edge(&self, _from: &H, _to: &H) {}
    fn device_knows_vertex(&self, _device: &D, _vertex: &H) {}
    fn remove_graph_edge(&self, _from: &H, _to: &H) {}
    fn remove_graph_vertex(&self, _label: &H) {}
}

impl<D: DeviceId, H: MessageDigest> EventGraphInspector<D, H> for () {}

pub struct EventGraph<D: DeviceId, H: MessageDigest, Insp: EventGraphInspector<D, H> = ()> {
    /// This device's own device id
    local_device: D,

    /// Event graph.
    ///
    /// Represented as a self-referential HashMap. We use a
    /// [`ThinMap`], which is a two-level [`HashMap`] with cheap
    /// self-references, to avoid bloating our data structure with
    /// long keys.
    ///
    /// We also need to assign a local sequence number to each
    /// incoming event. By relying on a thin index type which also
    /// happens to be ordered and assigned sequentially, and by
    /// inserting new events into this data structure only on and in
    /// the order of reception from the server, the thin index further
    /// serves as a cheap sequence number assignment to events.
    event_graph: ThinMap<H, EventNode<u64>, u64>,

    /// Event graph root nodes.
    ///
    /// These are all nodes in the `event_graph` which do not have an
    /// outgoing dependency edge (no dependencies which are maintained
    /// in the current `event_graph`). They are maintained to
    /// efficiently trim the graph, as they generally represent the
    /// oldest events which may still be referenced by other peers.
    roots: HashSet<u64>,

    /// Event graph leaf nodes, indexable by device.
    ///
    /// These are all nodes in the `event_graph` which do not have an incoming
    /// dependency edge (no reverse-dependencies) yet. We want to be able to
    /// index them with the device ID to collect all leaf nodes which should be
    /// known by a given subset of devices (for generating the dependency list
    /// of new events). However, to efficiently remove leaves from this map
    /// based on incoming events, also store the inverse mapping.
    device_leaves: HashMap<D, HashSet<u64>>,
    leaf_device: HashMap<u64, D>,

    /// Per device "seen events" tracker.
    ///
    /// Events are tracked through a sequence number (= thin index)
    /// which indicates the first sequence number of events which is
    /// not known by a device, and then an ordered deque of sequence
    /// numbers which are non-consecutive and thus cannot be merged
    /// with the first.
    ///
    /// This does not include events of our local device. For this, we
    /// can use the next assigned sequence number, which the
    /// [`ThinMap`] maintains.
    device_known_events: HashMap<D, (u64, VecDeque<u64>)>,

    /// Event graph "inspector"
    ///
    /// A client for actions which modify the internally maintained graph.
    insp: Insp,
}

impl<D: DeviceId, H: MessageDigest> EventGraph<D, H, ()> {
    pub fn new(local_device: D) -> Self {
	Self::with_inspector(local_device, ())
    }
}


impl<D: DeviceId, H: MessageDigest, Insp: EventGraphInspector<D, H>> EventGraph<D, H, Insp> {
    pub fn iter_edges(&self) -> impl Iterator<Item=(&H, &H)> {
	self.event_graph
	    .iter()
	    .flat_map(move |(hash, (_, node))| {
		node.deps
		    .iter()
		    .filter_map(move |dep_idx| {
			let (dep_hash, _) = self.event_graph.get_thin(dep_idx)?;
			Some((dep_hash, hash))
		    })
	    })
    }

    pub fn with_inspector(local_device: D, inspector: Insp) -> Self {
	EventGraph {
	    local_device,
	    event_graph: ThinMap::new(),
	    roots: HashSet::new(),
	    device_leaves: HashMap::new(),
	    leaf_device: HashMap::new(),
	    device_known_events: HashMap::new(),
	    insp: inspector,
	}
    }

    fn device_knows_event(&self, device: &D, thin_idx: u64) -> bool {
	if *device == self.local_device {
	    // We assign indices sequentially:
	    thin_idx < self.event_graph.next_thin_idx()
	} else {
	    if let Some((base_idx, known_events)) = self.device_known_events.get(device) {
		if thin_idx < *base_idx {
		    // Index is within the compressed, contiguous set
		    // of sequence numbers known to this device:
		    true
		} else {
		    // Lookup in the ordered set of non-contiguous
		    // known event sequence numbers:
		    known_events.binary_search(&thin_idx).is_ok()
		}
	    } else {
		// Device not known to us
		false
	    }
	}
    }

    fn add_device_known_event(&mut self, device: &D, event_thin_idx: u64) {
	if *device == self.local_device {
	    return;
	}

	if !self.device_known_events.contains_key(device) {
	    self.device_known_events.insert(
		device.clone(), (<u64 as ThinMapIdx>::base(), VecDeque::new()));
	}

	let (known_events_idx, known_events_deque) =
	    self.device_known_events.get_mut(device).unwrap();

	// Check whether the new event continues the sequence of consecutive
	// known events:
	if *known_events_idx == event_thin_idx {
	    // In this case add it and walk the deque until a missing event is
	    // found:
	    *known_events_idx = known_events_idx.incr();
	    while known_events_deque.len() != 0 {
		if *known_events_idx == *known_events_deque.front().unwrap() {
		    *known_events_idx = known_events_idx.incr();
		    known_events_deque.pop_front();
		}
	    }
	} else {
	    // This event is not continuing the consecutive event sequence,
	    // hence insert it into the sorted VecDeque of known events:
	    let insertion_idx = known_events_deque
		.binary_search(&event_thin_idx)
		.err()
		.expect(&format!(
		    "EventTree: trying to insert event {:?} already known for device {:?}", event_thin_idx, device));
	    known_events_deque.insert(insertion_idx, event_thin_idx);
	}
    }

    /// TODO DOCCOMMENT
    ///
    /// This function assumes that the event dependencies are provided as part
    /// of the event, and are thus covered by the event's hash. The hash of the
    /// event must be generated or verified on the client, prior to calling this
    /// function.
    pub fn insert_event(&mut self, sender: D, event: H, event_dependencies: Vec<H>) -> Result<(), EventGraphError<H>> {
	// Make sure we don't already know this event. We may never
	// receive an identical event twice!
	if self.event_graph.contains_key(&event) {
	    return Err(EventGraphError::ReplayedEvent);
	}

	// TODO: broken invariant
	//
	// - dev_a_eg.insert_event("dev_a", "event_0", []);
	// - dev_a_eg.insert_event("dev_a", "event_1", ["event_0"]);
	// - dev_a_eg.insert_event("dev_a", "event_2", ["event_0"]);
	// - dev_a_eg.insert_event("dev_a", "event_3", ["event_2"]);
	// - dev_a_eg.insert_event("dev_a", "event_4", ["event_1", "event_3"]);
	//
	// event_1 and event_4 are marked as leaves! ==> Check that a single
	// device does not branch! Can we efficiently verify this? What are the
	// consequences? Is it sufficient for us to check the return value of
	// `self.leaves.insert(sender.clone(), event_thin_idx);` and tell the
	// inspector? Maybe one device SHOULD be able to branch for concurrent
	// events?
	//
	// Most likely solution: one device must be able to have multiple leaf
	// events.

	// For all event dependencies, ensure that:
	//
	// 1. We know of this dependency and hold it in our (trimmed) event
	//    graph. Events are only pruned when we determine that there may no
	//    longer be any references to them, assuming well-behaving clients
	//    and a server providing sequential consitency.
	//
	// 2. The specified dependency order matches our local sequencing of
	//    received events. If this property is violated, either the remote
	//    client lied or the server did not provide proper sequential
	//    consistency.
	//
	// 3. The event dependency hash does not coincide with the event itself
	//    (hash collision). While unlikely, we are not in control of the
	//    hash function used and must guarantee consitency of our data
	//    structure in every case. This is implicitly guaranteed by ensuring
	//    that the event's hash is not yet in the event graph, but all event
	//    dependencies are.
	//
	// Furthermore, this iterator resolves the thin indices of all
	// dependencies (while retaining order) for later insertion of the
	// event.
	//
	// TODO: verify that a given leaf node of the sender is referenced in
	// this event's dependencies.
	let mut current_seq = <u64 as ThinMapIdx>::base();
	let mut event_dependencies_thin: Vec<u64> = Vec::with_capacity(event_dependencies.len());
	for dep in event_dependencies.iter() {
	    // Retrieve the event from our event graph, including the thin index
	    // (which we dual-use as a sequencer):
	    let (event_idx, _) = self.event_graph.get(dep)
		.ok_or(EventGraphError::EventDependencyUnknown)?;

	    // Check whether the dependency follows our local sequence order:
	    if event_idx >= current_seq {
		current_seq = event_idx;
	    } else {
		// If we have a sequence mismatch, provide the last in-order and
		// first out-of-order dependency.
		//
		// `.unwrap()` safety: `current_seq` is unsigned and starts at
		// `0`, for which this check will always succeed. Hence if this
		// code executes, we've set `current_seq` to a valid, in-graph
		// event at least once. We can use this index to get the event's
		// hash.
		let in_order_event_hash =
		    self.event_graph.lookup_thin(&current_seq).unwrap().clone();
		return Err(EventGraphError::EventDependencyOrderMismatch(in_order_event_hash, dep.clone()));
	    }

	    // Insert the event's thin idx into the vec of thin indices:
	    event_dependencies_thin.push(event_idx);
	}

	// ---------- GRAPH UPDATE PHASE ----------

	// The event is valid, insert it. Inform the inspector:
	self.insp.add_graph_vertex(&event);

	// Inform the inspector about the new dependency relations (only
	// forward-dependencies):
	for dep in event_dependencies.iter() {
	    self.insp.add_graph_edge(dep, &event);
	}

	// Any dependencies of this events which were marked as leaves
	// previously must now be unmarked:
	for thin_dep in event_dependencies_thin.iter() {
	    if let Some(dev) = self.leaf_device.get(thin_dep).cloned() {
		// This dependency is a current leaf node in the graph, remove
		// it from `leaf_device` and `device_leaves`, but first inform
		// the inspector:
		self.insp.set_graph_vertex_leaf(
		    self.event_graph.get_thin(thin_dep).unwrap().0, false);

		// Remove the leaf node from the `leaf_device` map:
		self.leaf_device.remove(thin_dep);

		// Remove the leaf node from the `device_leaves` map:
		let dev_leaves = self.device_leaves.get_mut(&dev).unwrap();
		dev_leaves.remove(thin_dep);
	    }
	}

	// Properly insert it into the `event_graph`:
	let event_thin_idx = self.event_graph.insert(event.clone(), EventNode {
	    // TODO: it'd be great if we didn't have to clone here. However,
	    // we're only assigned the new event index when we've mutably
	    // borrowed event_graph already...
	    deps: event_dependencies_thin,
	    rev_deps: Vec::new(),
	}).0;


	// Add the current event to the event's dependencies' reverse
	// dependencies:
	for dep in event_dependencies.iter() {
	    // `.unwrap()` safety: we've already verified that all dependencies
	    // are contained in `event_graph` above.
	    self.event_graph.get_mut(dep)
		.unwrap().1.rev_deps.push(event_thin_idx);
	}

	// If this event does not have any dependencies itself, add it as a new
	// root node:
	if event_dependencies.len() == 0 {
	    // The event is fresh, it must not be in the set of roots already.
	    assert!(self.roots.insert(event_thin_idx));
	    self.insp.set_graph_vertex_root(&event, true);
	}

	// The event does not have any reverse-dependencies (yet), hence it must
	// further be added to the set of leaves.
	//
	// Given that the event is fresh, it must not be in the set of leaves
	// already.
	assert!(self.leaf_device.insert(event_thin_idx, sender.clone()).is_none());
	let dev_leaves = self.device_leaves.entry(sender.clone()).or_insert_with(|| HashSet::new());
	assert!(dev_leaves.insert(event_thin_idx));
	self.insp.set_graph_vertex_leaf(&event, true);

	// ---------- GRAPH UPDATE COMPLETE ----------

	// ---------- DEVICE KNOWN EVENTS UPDATE PHASE ----------

	// The device sending this event knows of this event, and all of its
	// transitive dependencies. Hence update the set of known events of the
	// sender accordingly. Given our data structure, it is most efficient to
	// go from oldest to newest events (in hopes that this will result in a
	// mostly-consecutive sequence). Hence we recursively go through the set
	// of unknown transitive dependencies and add them to the set of known
	// dependencies.
	let mut event_stack: Vec<(u64, usize)> = vec![(event_thin_idx, 0)];
	while event_stack.len() != 0 {
	    let current_stack_idx = event_stack.len() - 1;
	    let (e_thin_idx, mut e_dep_idx) = event_stack[current_stack_idx];

	    let ev = self.event_graph.get_thin(&e_thin_idx).unwrap().1;
	    if e_dep_idx == ev.deps.len() {
		// No more dependencies to process for this event, add it to the
		// device's known dependencies and pop it from the stack:
		self.add_device_known_event(&sender, e_thin_idx);
		self.insp.device_knows_vertex(&sender, &event);
		event_stack.pop();
	    } else {
		// More dependencies for this event, push the first unknown one
		// onto the stack.
		//
		// Update this event's stack entry dependency index accordingly.
		while e_dep_idx < ev.deps.len() {
		    if !self.device_knows_event(&sender, ev.deps[e_dep_idx]) {
			event_stack.push((ev.deps[e_dep_idx], 0));
			break;
		    }

		    e_dep_idx += 1;
		}

		event_stack[current_stack_idx].1 = e_dep_idx;
	    }
	}

	// ---------- DEVICE KNOWN EVENTS UPDATE COMPLETE ----------

	Ok(())
    }

    pub fn trim_graph(&mut self) {
	let mut pending_roots: VecDeque<u64> = self.roots
	    .iter().cloned().collect();

	while pending_roots.len() > 0 {
	    // Pop one element and process it:
	    let root_idx = pending_roots.pop_front().unwrap();
	    let (root_hash, root) = self.event_graph.get_thin(&root_idx)
		.expect("EventGraph is missing a root event");

	    // We must never delete a leaf node. The set of leaf nodes is only
	    // efficiently indexable by a device id, but we can also determine
	    // an element to be a leaf node if its set of reverse dependencies
	    // is empty:
	    if root.rev_deps.len() == 0 {
		continue;
	    }

	    // If a given event has a set of reverse-dependencies, where each
	    // device knows of at least one of these reverse dependencies, then
	    // we can remove it from the tree given it will never be referenced
	    // any more:
	    let mut remain_devices: VecDeque<D> = self.device_known_events
		.keys().cloned().collect();
	    for rev_dep_idx in root.rev_deps.iter() {
		// Exit early if all devices know at least one event:
		if remain_devices.len() == 0 {
		    break;
		}

		// Remove devices which know this event:
		remain_devices.retain(|dev| {
		    !self.device_knows_event(dev, *rev_dep_idx)
		});
	    }

	    // If this event is not known by all designated devices, process the
	    // next one. We've already removed it from `pending_roots`, it stays
	    // a root in the graph.
	    if !remain_devices.is_empty() {
		continue;
	    }

	    // The event can be removed from the graph, given it has reverse
	    // dependencies known by all devices and hence should never be
	    // referenced as a dependency again.
	    //
	    // To remove it, we need to (potentially) promote other events to be
	    // new root nodes in the graph. Specifically, for all reverse
	    // dependencies, if the node we are removing is the only path to a
	    // root in our (non-trimmed) graph, promote it to a new root.
	    for potential_root_idx in root.rev_deps.iter() {
		let (potential_root_hash, potential_root) = self.event_graph
		    .get_thin(&potential_root_idx)
		    .expect("EventGraph is missing a reverse dependency of a root event");

		// Because we iteratively remove root nodes from the tree and
		// will check all of the reverse dependencies again in each
		// step, it's sufficient for us to make sure that any reverse
		// dependency has one dependency which (1) isn't our current
		// root node and (2) is maintained in our graph.
		let has_other_dep =
		    potential_root.deps.iter().find(|potential_root_dep_idx| {
			**potential_root_dep_idx != root_idx
			    && self.event_graph.contains_thin_key(&potential_root_dep_idx)
		    }).is_some();

		// Promote it to a new root otherwise, and also add it to the
		// to-check nodes in trimming:
		if !has_other_dep {
		    assert!(
			self.roots.insert(*potential_root_idx),
			"EventGraph has node flagged as root even though it was the reverse-dependency of a root"
		    );
		    pending_roots.push_back(*potential_root_idx);
		    self.insp.set_graph_vertex_root(potential_root_hash, true);
		}
	    }

	    // Now that we've (potentially) promoted some other nodes to be
	    // roots, we can remove the node from our graph (and set of root
	    // nodes) for good.
	    for rev_dep_idx in root.rev_deps.iter() {
		let (rev_dep_hash, _) = self.event_graph.get_thin(&rev_dep_idx).unwrap();
		self.insp.remove_graph_edge(root_hash, rev_dep_hash);
	    }
	    self.insp.set_graph_vertex_root(root_hash, false);
	    self.insp.remove_graph_vertex(root_hash);
	    assert!(self.event_graph.remove_thin(&root_idx).is_some());
	    assert!(self.roots.remove(&root_idx));
	}
    }

    pub fn new_event_deps<'a>(&'a self, recipients: &'a [D]) -> impl Iterator<Item=&H> + '_ {
	recipients.iter()
	    .filter_map(move |recipient| {
		self.device_leaves
		    .get(recipient)
		    .map(|dev_leaves| dev_leaves.iter()
			 .map(move |ev_idx| {
			     self.event_graph.lookup_thin(ev_idx).unwrap()
			 })
		    )
	    })
	    .flatten()
    }
}
