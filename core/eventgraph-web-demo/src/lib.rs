use js_sys::{Array as JsArray, JsString, Function as JsFunction};
use wasm_bindgen::prelude::*;
use web_sys::console;
use std::str::FromStr;

use eventgraph::{DeviceId, EventGraph, EventGraphInspector, MessageDigest};

pub struct ConsoleEventGraphInspector {
    message_prefix: String,
}

impl ConsoleEventGraphInspector {
    pub fn new(message_prefix: String) -> Self {
        ConsoleEventGraphInspector { message_prefix }
    }

    fn log_string(&self, s: String) {
        // This incurs additional overhead by calling format once
        // more, but we don't care about that for now:
        console::log_1(&JsValue::from_str(&format!(
            "{}: {}",
            self.message_prefix, s
        )));
    }
}

impl<D: DeviceId, H: MessageDigest> EventGraphInspector<D, H> for ConsoleEventGraphInspector {
    fn add_graph_vertex(&self, label: &H) {
        self.log_string(format!("Add graph vertex with label \"{:?}\"", label));
    }

    fn set_graph_vertex_root(&self, label: &H, root: bool) {
        if root {
            self.log_string(format!(
                "Make graph vertex with label \"{:?}\" a root",
                label
            ));
        } else {
            self.log_string(format!(
                "Graph vertex with label \"{:?}\" is no longer a root",
                label
            ));
        }
    }

    fn set_graph_vertex_leaf(&self, label: &H, leaf: bool) {
        if leaf {
            self.log_string(format!(
                "Make graph vertex with label \"{:?}\" a leaf",
                label
            ));
        } else {
            self.log_string(format!(
                "Graph vertex with label \"{:?}\" is no longer a leaf",
                label
            ));
        }
    }

    fn add_graph_edge(&self, from: &H, to: &H) {
        self.log_string(format!(
            "Add graph edge from vertex \"{:?}\" to vertex \"{:?}\"",
            from, to
        ));
    }

    fn device_knows_vertex(&self, device: &D, vertex: &H) {
        self.log_string(format!(
            "Mark vertex \"{:?}\" as known to device \"{:?}\"",
            vertex, device
        ));
    }

    fn remove_graph_edge(&self, from: &H, to: &H) {
        self.log_string(format!(
            "Remove graph edge from vertex \"{:?}\" to vertex \"{:?}\"",
            from, to
        ));
    }

    fn remove_graph_vertex(&self, label: &H) {
        self.log_string(format!("Remove graph vertex labeled \"{:?}\"", label));
    }
}


pub struct CallbackEventGraphInspector {
    add_graph_vertex_cb: JsFunction,
    set_graph_vertex_root_cb: JsFunction,
    set_graph_vertex_leaf_cb: JsFunction,
    add_graph_edge_cb: JsFunction,
    device_knows_vertex_cb: JsFunction,
    remove_graph_edge_cb: JsFunction,
    remove_graph_vertex_cb: JsFunction,
}

impl<
	D: DeviceId + ToString + FromStr,
    H: MessageDigest + ToString + FromStr
	> EventGraphInspector<D, H> for CallbackEventGraphInspector {
    fn add_graph_vertex(&self, label: &H) {
	let _ = self.add_graph_vertex_cb.call1(
	    &JsValue::NULL,
	    &JsValue::from_str(&label.to_string())
	);
    }


    fn set_graph_vertex_root(&self, label: &H, root: bool) {
	let _ = self.set_graph_vertex_root_cb.call2(
	    &JsValue::NULL,
	    &JsValue::from_str(&label.to_string()),
	    &JsValue::from_bool(root),
	);
    }

    fn set_graph_vertex_leaf(&self, label: &H, leaf: bool) {
	let _ = self.set_graph_vertex_leaf_cb.call2(
	    &JsValue::NULL,
	    &JsValue::from_str(&label.to_string()),
	    &JsValue::from_bool(leaf),
	);
    }

    fn add_graph_edge(&self, from: &H, to: &H) {
	let _ = self.add_graph_edge_cb.call2(
	    &JsValue::NULL,
	    &JsValue::from_str(&from.to_string()),
	    &JsValue::from_str(&to.to_string()),
	);
    }

    fn device_knows_vertex(&self, device: &D, vertex: &H) {
	let _ = self.device_knows_vertex_cb.call2(
	    &JsValue::NULL,
	    &JsValue::from_str(&device.to_string()),
	    &JsValue::from_str(&vertex.to_string()),
	);
    }

    fn remove_graph_edge(&self, from: &H, to: &H) {
	let _ = self.remove_graph_edge_cb.call2(
	    &JsValue::NULL,
	    &JsValue::from_str(&from.to_string()),
	    &JsValue::from_str(&to.to_string()),
	);
    }

    fn remove_graph_vertex(&self, label: &H) {
	let _ = self.remove_graph_vertex_cb.call1(
	    &JsValue::NULL,
	    &JsValue::from_str(&label.to_string())
	);
    }
}


#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct StringDeviceId(pub String);
impl DeviceId for StringDeviceId {}
impl FromStr for StringDeviceId {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
	Ok(StringDeviceId(s.to_string()))
    }
}
impl ToString for StringDeviceId {
    fn to_string(&self) -> String {
	self.0.clone()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct StringMessageDigest(pub String);
impl MessageDigest for StringMessageDigest {}
impl FromStr for StringMessageDigest {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
	Ok(StringMessageDigest(s.to_string()))
    }
}
impl ToString for StringMessageDigest {
    fn to_string(&self) -> String {
	self.0.clone()
    }
}


type DebugStringEventGraph =
    EventGraph<StringDeviceId, StringMessageDigest, CallbackEventGraphInspector>;

#[wasm_bindgen]
pub struct DebugStringEventGraphWrapper {
    graph: *mut DebugStringEventGraph
}

#[wasm_bindgen]
impl DebugStringEventGraphWrapper {
    pub fn new(
        local_device_id: String,
        // debug_message_prefix: String,
	add_graph_vertex_cb: JsFunction,
	set_graph_vertex_root_cb: JsFunction,
	set_graph_vertex_leaf_cb: JsFunction,
	add_graph_edge_cb: JsFunction,
	device_knows_vertex_cb: JsFunction,
	remove_graph_edge_cb: JsFunction,
	remove_graph_vertex_cb: JsFunction,
    ) -> DebugStringEventGraphWrapper {
	DebugStringEventGraphWrapper {
	    graph: Box::leak(Box::new(DebugStringEventGraph::with_inspector(
		StringDeviceId(local_device_id),
		CallbackEventGraphInspector {
		    add_graph_vertex_cb,
		    set_graph_vertex_root_cb,
		    set_graph_vertex_leaf_cb,
		    add_graph_edge_cb,
		    device_knows_vertex_cb,
		    remove_graph_edge_cb,
		    remove_graph_vertex_cb,
		},
            ))) as *mut _
	}
    }

    pub fn insert_event(
        &self,
        sender: String,
        event: String,
        event_dependencies: JsArray,
    ) -> Result<(), usize> {
        let deps_vec: Vec<StringMessageDigest> = event_dependencies
            .iter()
            .map(|js_str| js_str.as_string().map(StringMessageDigest).ok_or(1))
            .collect::<Result<Vec<StringMessageDigest>, usize>>()?;

        let _ = (unsafe { &mut *self.graph }).insert_event(
            StringDeviceId(sender),
            StringMessageDigest(event),
            deps_vec,
        );

        Ok(())
    }

    pub fn trim_graph(&self) {
        (unsafe { &mut *self.graph }).trim_graph()
    }

    pub fn new_event_deps(&self, recipients: JsArray) -> JsArray {
	let recipients_vec: Vec<StringDeviceId> = recipients
	    .iter()
	    .filter_map(|js_str| js_str.as_string().map(StringDeviceId))
	    .collect();


	(unsafe { &*self.graph }).new_event_deps(&recipients_vec.as_ref()).map(|strmd| JsString::from(strmd.0.as_ref())).collect()
    }

    pub fn get_edges(&self) -> JsArray {
        (unsafe { &*self.graph })
            .iter_edges()
            .map(|(a, b)| {
                JsArray::of2(&JsString::from(a.0.as_ref()), &JsString::from(b.0.as_ref()))
            })
            .collect()
    }

    pub fn drop(self) {
        unsafe { Box::from_raw(self.graph) };
    }
}

#[wasm_bindgen(start)]
pub fn init() -> Result<(), JsValue> {
    // This provides better error messages.
    console_error_panic_hook::set_once();

    console::log_1(&JsValue::from_str("Hello world from Rust!"));

    Ok(())
}
