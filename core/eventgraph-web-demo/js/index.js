function device_event_graph(eg, device_id, vis_graph, console_prefix) {
    function update_node(node_id, update_cb) {
	let node = update_cb(vis_graph.nodes.get(node_id));
	vis_graph.nodes.update({
	    ...node,
	    label: `${node._eg_raw_label}${node._eg_root ? "_R" : ""}${node._eg_leaf ? "_L" : ""}`
	})
    }

    return eg.new(
	device_id,

	label => /* Add graph vertex */ {
	    console.log(`${console_prefix}: add vertex "${label}"`);
	    vis_graph.nodes.add([{
		id: label,
		label: label,
		shape: "ellipse",
		_eg_raw_label: label,
		_eg_root: false,
		_eg_leaf: false,
	    }]);
	},

	(label, root) => /* Set graph vertex root */ {
	    console.log(`${console_prefix}: set vertex root state: "${label}", ${root}`);
	    update_node(label, node => ({
		...node,
		_eg_root: root,
	    }));
	},

	(label, leaf) => /* Set graph vertex leaf */ {
	    console.log(`${console_prefix}: set vertex leaf state: "${label}", ${leaf}`);
	    update_node(label, node => ({
		...node,
		_eg_leaf: leaf,
	    }));
	},

	(from, to) => /* Add graph edge */ {
	    console.log(`${console_prefix}: add edge from "${from}" to "${to}"`);
	    vis_graph.edges.add([{
		id: `${from}${to}`,
		from,
		to,
		arrows: {
		    to: {
			enabled: true,
		    },
		},
	    }]);
	},

	(device, vertex) => /* Device knows vertex */ {
	    // TODO
	},

	(from, to) => /* Remove graph edge */ {
	    console.log(`${console_prefix}: add edge from "${from}" to "${to}"`);
	    vis_graph.edges.remove(`${from}${to}`);
	},

	label => /* Remove graph vertex */ {
	    console.log(`${console_prefix}: remove vertex "${label}"`);
	    vis_graph.nodes.remove(label);
	},
    );
}

import("../pkg/index.js")
    .catch(console.error)
    .then(obj => {
	// Set a global reference to the event graph wrapper, such
	// that we can access it from the developer tools:
	window.eg = obj.DebugStringEventGraphWrapper;

	// Create a new vis graph and set it to be rendered to a div:
	let vis_graph_data = {
	    nodes: new vis.DataSet([]),
	    edges: new vis.DataSet([]),
	};
	let vis_graph = new vis.Network(
	    document.getElementById("event_graph"),
	    vis_graph_data,
	    // Other configuration:
	    {
		autoResize: true,
		interaction: { zoomView: false },
		physics: {
		    solver: 'barnesHut',

		    barnesHut: {
			gravitationalConstant: -2000,
			theta: 0.25,
			centralGravity: 0.25,
			springLength: 100,
			springConstant: 0.04,
			damping: 0.35,
			avoidOverlap: 0,
		    },
		},
	    }
	);
	window.vis_graph = vis_graph;
	window.vis_graph_data = vis_graph_data;

	// Create a Rust event_graph which is instructed to draw onto
	// the vis graph:
	let dev_a_eg = device_event_graph(window.eg, "dev_a", vis_graph_data, "Event graph \"dev_a\"");
	window.dev_a_eg = dev_a_eg;
    });
