/*
 ************
 ************
 *** Core ***
 ************
 ************
 */

import * as sc from "./serverComm/socketIO.js";
import * as c from  "./crypto/libSodium.js";
import * as db from "./db/localStorage.js";

export { db };

/* Local variables */

const SLASH = "/";
const DATA  = "__data";
const GROUP = "__group";
const GROUP_KEY_PREFIX = DATA + SLASH + GROUP + SLASH;
const LINKED   = "__linked";
const CONTACTS = "__contacts";
const PUBKEY   = "pubkey";
const PRIVKEY  = "privkey";

// FIXME need new special name for LINKED group (confusing when linking non-LINKED groups)

// valid message types
const REQ_UPDATE_LINKED     = "requestUpdateLinked";
const CONFIRM_UPDATE_LINKED = "confirmUpdateLinked";
const LINK_GROUPS           = "linkGroups";
const ADD_PARENT            = "addParent";
const NEW_GROUP             = "addNewGroup";
const DELETE_SELF           = "deleteSelf";
const DELETE_GROUP          = "deleteGroup";
const REQ_CONTACT           = "requestContact";
const CONFIRM_CONTACT       = "confirmContact";
const UPDATE_DATA           = "updateData";

// demultiplexing map from message types to functions
const demuxMap = {
  [REQ_UPDATE_LINKED]:     processUpdateLinkedRequest,
  [CONFIRM_UPDATE_LINKED]: confirmUpdateLinked,
  [LINK_GROUPS]:           linkGroups,
  [ADD_PARENT]:            addParent,
  [NEW_GROUP]:             addNewGroup,
  [DELETE_SELF]:           deleteDevice,
  [DELETE_GROUP]:          deleteGroup,
  [REQ_CONTACT]:           processRequestContact,
  [CONFIRM_CONTACT]:       confirmContact,
  [UPDATE_DATA]:           updateData,
};

export { GROUP_KEY_PREFIX as groupPrefix };
export { PUBKEY as pubkeyPrefix };

// default auth/unauth functions do nothing
let onAuth   = () => {};
let onUnauth = () => {};

// default callback
let defaultValidateCallback = (payload) => {
  console.log("validating payload...");
  console.log(payload)
};
let validateCallback = defaultValidateCallback;

let storagePrefixes = [GROUP];

function makeGroup(fieldNames) {
  fieldNames = fieldNames.split(' ');
  let numFields = fieldNames.length;
  function constructor() {
    for (let i = 0; i < numFields; i++) {
      this[fieldNames[i]] = arguments[i];
    }
  }
  return constructor;
}

/* doubly-linked tree, allows cycles */
const Key   = makeGroup("name parents");
const Group = makeGroup("name parents children");

/* DB listener plugin */

function createFridaDBListenerPlugin() {
  return () => {
    window.addEventListener("storage", (e) => {
      if (e.key === null) {
        onUnauth();
      } else if (e.key.includes(PUBKEY)) {
        onAuth();
      }
    });
  };
}

export { createFridaDBListenerPlugin as dbListenerPlugin };

/*
 *********************
 * Server Connection *
 *********************
 */

/**
 * Initializes client-server connection and client state.
 *
 * @param {string} ip server IP address
 * @param {string} port server port number
 * @param {{ onAuth: callback,
 *           onUnauth: callback, 
 *           validateCallback: callback}} config client configuration options
 */
export function init(ip, port, config) {
  sc.init(ip, port);
  if (config.onAuth) {
    onAuth = config.onAuth;
  }
  if (config.onUnauth) {
    onUnauth = config.onUnauth;
  }
  if (config.validateCallback) {
    validateCallback = config.validateCallback;
  }
  if (config.storagePrefixes) {
    config.storagePrefixes.forEach((prefix) => {
      storagePrefixes.push(prefix);
    });
  }
}

/**
 * Connects the device to the server, e.g. when a client adds a new
 * device or when a previously-added device comes back online.
 *
 * @param {?string} pubkey public key of current device
 */
export function connectDevice(pubkey = null) {
  if (pubkey !== null) {
    sc.connect(pubkey);
  } else {
    sc.connect(getPubkey());
  }
}

/**
 * Simulates offline devices
 */
export function disconnectDevice() {
  sc.disconnect(getPubkey());
}

/*
 **********************
 * Message Processing *
 **********************
 */

/**
 * Called like: sendMessage(resolveIDs(id), payload) (see example in 
 * deleteAllLinkedDevices()).
 *
 * TODO better to take in the current device's pub/priv-keys as arguments? 
 *
 * @param {string[]} dstPubkeys public keys to send message to
 * @param {Object} payload message contents
 */
export function sendMessage(dstPubkeys, payload) {
  let batch = new Array();
  let srcPubkey = getPubkey();
  let srcPrivkey = getPrivkey();

  dstPubkeys.forEach(dstPubkey => {
    // encrypt payload separately for each destination 
    let { ciphertext: encPayload, nonce: nonce } = c.signAndEncrypt(
      dstPubkey,
      srcPrivkey,
      db.toString(payload)
    );
    batch.push({
      dstPubkey: dstPubkey,
      encPayload: encPayload,
      nonce: nonce,
    });
  });

  // send message to server
  sc.sendMessage({
    srcPubkey: srcPubkey,
    batch: batch,
  });
}

/**
 * Decrypts, validates, and demultiplexes the received message to
 * appropriate handler.
 *
 * TODO consider: expose ordered or unordered message reception?
 * E.g. ordered may be simpler to program against but maybe 
 * real-time apps would benefit from an unordered API (perhaps
 * make this composable?).
 *
 * @param {{ seqID: number,
 *           encPayload: string,
 *           nonce: string,
 *           srcPubkey: string }} msg message with encrypted contents
 */
export function onMessage(msg) {
  console.log("seqID: " + msg.seqID);
  let curPrivkey = getPrivkey();
  if (curPrivkey !== null) {
    let payload = db.fromString(
      c.decryptAndVerify(
        msg.encPayload,
        msg.nonce,
        msg.srcPubkey,
        curPrivkey
      )
    );

    // validate via callback
    validate(payload);

    let demuxFunc = demuxMap[payload.msgType];
    if (demuxFunc === undefined) {
      console.log("ERROR UNKNOWN msgType: " + payload.msgType);
      return;
    }
    demuxFunc(payload);
  }
}

/**
 * Sets the callback function with which to perform message validation
 * for this application. 
 *
 * TODO validate newValidateCallback to ensure it only takes one arg (payload).
 *
 * @param {callback} newValidateCallback new validation callback
 */
export function setValidateCallback(callback) {
  validateCallback = callback;
}

/**
 * Validates a message via the validateCallback, which can either be:
 * defined by the application (through setValidateCallback()), or
 * the default callback (defaultValidateCallback).
 *
 * @param {string} payload the decrypted message contents
 *
 * @private
 */
function validate(payload) {
  validateCallback(payload);
}

/**
 * Resolves a list of one or more group IDs to a list of public keys.
 *
 * @param {string[]} ids group IDs to resolve
 * @return {string[]}
 */
export function resolveIDs(ids) {
  let pubkeys = [];
  ids.forEach((id) => {
    let group = getGroup(id);
    if (group !== null) {
      if (isKey(group)) {
        pubkeys.push(id);
      } else {
        pubkeys = pubkeys.concat(resolveIDs(group.children));
      }
    }
  });
  return pubkeys;
}

/**
 * Helper function for determining if resolveIDs has hit it's base case or not.
 *
 * @param {Object} group a group
 * @returns {boolean}
 *
 * @private
 */
function isKey(group) {
  if (group.children) {
    return false;
  }
  return true;
}

/*
 ************
 * Creation *
 ************
 */

/**
 * Initializes a new device with a keypair and adds the public key to the
 * server.
 *
 * @param {string[]} parents parent groups of this new device
 * @param {?string} linkedName human-readable name (for contacts)
 * @param {?string} deviceName human-readable name (for self)
 * @returns {string}
 *
 * @private
 */
function initDevice(parents, linkedName = null, deviceName = null) {
  let { pubkey, privkey } = c.generateKeypair();
  setPubkey(pubkey);
  setPrivkey(privkey);
  sc.addDevice(pubkey);
  connectDevice(pubkey);

  createKey(pubkey, deviceName, parents);
  createGroup(CONTACTS, null, [], []);
  // enforce that linkedName exists; deviceName is not necessary
  if (linkedName === null) {
    linkedName = crypto.randomUUID();
  }
  createGroup(LINKED, linkedName, [], [pubkey]);
  return pubkey;
}

/**
 * Initializes device and its linked group.
 *
 * @param {?string} linkedName human-readable name (for contacts)
 * @param {?string} deviceName human-readable name (for self)
 * @returns {string}
 */
export function createDevice(linkedName = null, deviceName = null) {
  let pubkey = initDevice([LINKED], linkedName, deviceName);
  onAuth();
  return pubkey;
}

/**
 * Initializes device and requests to link with existing device.
 *
 * @param {string} dstPubkey hex-formatted public key of device to link with
 * @param {?string} deviceName human-readable name (for self)
 * @returns {string}
 */
export function createLinkedDevice(dstPubkey, deviceName = null) {
  if (dstPubkey !== null) {
    let pubkey = initDevice([LINKED], null, deviceName);
    // construct message that asks dstPubkey's corresponding device to
    // link this device
    sendMessage([dstPubkey], {
      msgType: REQ_UPDATE_LINKED,
      newID: pubkey,
      newValue: getGroup(pubkey),
    });
    return pubkey;
  }
}

/*
 ************
 * Updating *
 ************
 */

/**
 * Creates a new group for the requesting device, adds the new group ID to the 
 * current device's linked group, and send the requesting device the list of 
 * and group information of any existing devices (including the current one).
 *
 * TODO send other data from this device (e.g. app data)? Would be useful for 
 * backups.
 *
 * @param {string} newID ID of new group
 * @param {Obejct} newValue value of new group
 *
 * @private
 */
function processUpdateLinkedRequest({ newID, newValue }) {
  if (confirm(`Authenticate new LINKED group member?\n\tName: ${newID}`)) {
    // get subtree structure of LINKED to send to new member device
    let existingSubgroups = getAllSubgroups([LINKED, CONTACTS]);

    // get rest of linked pubkeys to update
    let pubkey = getPubkey();
    let restLinkedPubkeys = resolveIDs([LINKED]).filter((x) => x != pubkey);

    /* UPDATE OLD SELF */

    // update groups locally
    addNewGroup({ id: newID, value: newValue });
    let newLinked = linkGroups({ parentID: LINKED, childID: newID });

    // update groups remotely
    sendMessage(restLinkedPubkeys, {
      msgType: NEW_GROUP,
      id: newID,
      value: newValue,
    });
    sendMessage(restLinkedPubkeys, {
      msgType: LINK_GROUPS,
      parentID: LINKED,
      childID: newID,
    });

    /* UPDATE NEW SELF */

    // notify new group member successful link and piggyback existing group info
    sendMessage(resolveIDs([newID]), {
      msgType: CONFIRM_UPDATE_LINKED,
      newLinked: newLinked,
      existingSubgroups: existingSubgroups,
    });

    /* UPDATE OTHER */

    // notify contacts, replacing LINKED pointer with "linked name"
    let contactPubkeys = resolveIDs([CONTACTS]);
    sendMessage(contactPubkeys, {
      msgType: NEW_GROUP,
      id: newID,
      value: {
        ...newValue,
        parents: newValue.parents.filter((x) => x != LINKED),
      },
    });
    sendMessage(contactPubkeys, {
      msgType: LINK_GROUPS,
      parentID: getGroup(LINKED).name,
      childID: newID,
    });
  }
}

/**
 * Updates linked group info and and group info for all devices that are 
 * children of the linked group.
 *
 * TODO also process any other data sent from the device being linked with.
 *
 * @param {Object} newLinked new value of LINKED group
 * @param {Object[]} existingSubgroups existing groups on linked device
 *
 * @private
 */
function confirmUpdateLinked({ newLinked, existingSubgroups }) {
  existingSubgroups.forEach(({ ID, group }) => {
    setGroup(ID, group);
  });
  setGroup(LINKED, newLinked);
  //addParent({ groupID: newID, parentID: LINKED });
  onAuth();
}

/**
 * Links parentID with childID by updating their childrens and parents lists,
 * respectively.
 *
 * @param {string} parentID ID of group to update
 * @param {string} childID ID of new group
 *
 * @private
 */
function linkGroups({ parentID, childID }) {
  addParent({ groupID: childID, parentID: parentID });
  return addChild(parentID, childID);
}

/**
 * Adds a new group to this device.
 *
 * @param {string} ID group ID
 * @param {Object} value group value
 * 
 * @private
 */
function addNewGroup({ id, value }) {
  setGroup(id, value);
}

/*
 ************
 * Contacts *
 ************
 */

/**
 * Shares own contact info and requests the contact info of contactPubkey.
 * TODO implement private contact discovery and return contact name.
 *
 * @param {string} contactPubkey hex-formatted public key
 */
export function addContact(contactPubkey) {
  // piggyback own contact info when requesting others contact info
  sendMessage([contactPubkey], {
    msgType: REQ_CONTACT,
    reqContactGroups: getAllSubgroups([LINKED]),
  });
}

/**
 * Asks user if contact exchange should be accepted, and if so processes
 * and stores the requesting party's contact info and sends back own 
 * contact info.
 *
 * @param {Object[]} reqContactGroups list of requesting party's linked subgroups
 *
 * @private
 */
function processRequestContact({ reqContactGroups }) {
  let contactName = getContactName(reqContactGroups);
  if (confirm(`Add new contact: ${contactName}?`)) {
    parseContactInfo(contactName, reqContactGroups);
    sendMessage(resolveIDs([contactName]), {
      msgType: CONFIRM_CONTACT,
      contactGroups: getAllSubgroups([LINKED]),
    });
  }
}

/**
 * Processes and stores the requested contact info.
 *
 * @param {Object[]} contactGroups linked group information of requested contact
 *
 * @private
 */
function confirmContact({ contactGroups }) {
  parseContactInfo(getContactName(contactGroups), contactGroups);
}

/**
 * Gets the linked name of the supplied contact information.
 *
 * @param {Object[]} contactGroups linked group information of contact
 * @returns {string}
 *
 * @private
 */
function getContactName(contactGroups) {
  let contactName;
  contactGroups.forEach((contactGroup) => {
    if (contactGroup.ID === LINKED) {
      contactName = contactGroup.group.name !== null ? contactGroup.group.name : crypto.randomUUID();
      return;
    }
  });
  return contactName;
}

/**
 * Parses and stores the supplied contact info, relinking previous 
 * parent/child pointers from LINKED to contactName.
 *
 * @param {string} contactName contact name
 * @param {Object[]} contactGroups contact's linked group information
 *
 * @private
 */
function parseContactInfo(contactName, contactGroups) {
  let pubkey = getPubkey();
  let restLinkedPubkeys = resolveIDs([LINKED]).filter((x) => x != pubkey);

  contactGroups.forEach((contactGroup) => {
    if (contactGroup.ID === LINKED) {
      // update groups locally
      addNewGroup({ id: contactName, value: contactGroup.group });
      linkGroups({
        parentID: CONTACTS,
        childID: contactName,
      });
      // notify remaining linked devices of updated CONTACTS group
      sendMessage(restLinkedPubkeys, {
        msgType: NEW_GROUP,
        id: contactName,
        value: contactGroup.group,
      });
      sendMessage(restLinkedPubkeys, {
        msgType: LINK_GROUPS,
        parentID: CONTACTS,
        childID: contactName,
      });
    } else {
      // replace backpointer to LINKED group with backpointer to contactName
      setGroup(contactGroup.ID, contactGroup.group);
      removeParent(contactGroup.ID, LINKED);
      // notify linked devices of new contact subgroups
      sendMessage(restLinkedPubkeys, {
        msgType: NEW_GROUP,
        id: contactGroup.ID,
        value: addParent({ groupID: contactGroup.ID, parentID: contactName }),
      });
    }
  });
}

/**
 * Remove contact.
 *
 * @param {string} name contact name
 */
export function removeContact(name) {
  sendMessage(resolveIDs([LINKED]), {
    msgType: DELETE_GROUP,
    groupID: name,
  });
}

/**
 * Get all contacts.
 *
 * @returns {string[]}
 */
export function getContacts() {
  return getChildren(CONTACTS);
}

/**
 * Get pending contacts.
 * TODO implement pending list.
 *
 * @returns {string[]}
 */
export function getPendingContacts() {
  return [];
}

/*
 ************
 * Deletion *
 ************
 */

/**
 * Deletes the current device's data and removes it's public key from 
 * the server.
 *
 * TODO validate that this message is coming from a known device.
 */
export function deleteDevice() {
  let pubkey = getPubkey();
  // get all groupIDs that directly point to this key
  sendMessage(resolveIDs(getParents(pubkey)), {
    msgType: DELETE_GROUP,
    groupID: pubkey,
  });
  sc.removeDevice(pubkey);
  sc.disconnect(pubkey);
  db.clear();
  onUnauth();
}

/**
 * Deletes the device pointed to by pubkey.
 *
 * @param {string} pubkey hex-formatted public key
 */
export function deleteLinkedDevice(pubkey) {
  sendMessage([pubkey], {
    msgType: DELETE_SELF,
  });
}

/**
 * Deletes all devices that are children of this device's linked group.
 */
export function deleteAllLinkedDevices() {
  sendMessage(resolveIDs([LINKED]), {
    msgType: DELETE_SELF,
  });
}

/**
 * Unlinks the group denoted by groupID from its parents and children
 * and then deletes the group itself.
 *
 * @param {string} groupID ID of group to delete
 *
 * @private
 */
function deleteGroup({ groupID }) {
  // unlink this group from parents
  getParents(groupID).forEach((parentID) => {
    removeChild(parentID, groupID);
  });
  // unlink children from this group
  getChildren(groupID).forEach((childID) => {
    removeParent(childID, groupID);
    // garbage collect any KEY group that no longer has any parents
    if (isKey(getGroup(childID)) && getParents(childID).length === 0) {
      removeGroup(childID);
    }
  });
  // delete group
  removeGroup(groupID);
  // TODO more GC?
}

/*
 ************
 * Grouping *
 ************
 */

/**
 * Wrapper function for assigning a group ID to a group object consisting
 * of a name and children list.
 *
 * @param {string} ID group ID
 * @param {string} name human-readable name
 * @param {string[]} parents groups that point to this group
 * @param {string[]} children groups that this group points to
 *
 * @private
 */
function createGroup(ID, name, parents, children) {
  setGroup(ID, new Group(name, parents, children));
}

/**
 * Wrapper function for assigning a key ID to a key object consisting
 * of a name.
 *
 * @param {string} ID hex-formatted public key
 * @param {string} name human-readable name
 * @param {string} parents groups that point to this group
 *
 * @private
 */
function createKey(ID, name, parents) {
  setGroup(ID, new Key(name, parents));
}

/**
 * Gets childrens list of group with groupID.
 *
 * @param {string} groupID ID of group to get children of
 * @returns {string[]}
 *
 * @private
 */
function getChildren(groupID) {
  return getGroup(groupID)?.children ?? [];
}

/**
 * Recursively gets all children groups in the subtree with root groupID.
 *
 * @param {string} groupID ID of group to get all subgroups of
 * @returns {Object[]}
 *
 * @private
 */
function getAllSubgroups(groupIDs) {
  let groups = [];
  groupIDs.forEach((groupID) => {
    let group = getGroup(groupID);
    if (group !== null) {
      groups.push({
        ID: groupID,
        group: group,
      });
      if (group.children !== undefined) {
        groups = groups.concat(getAllSubgroups(group.children));
      }
    }
  });
  return groups;
}

/**
 * Adds an additional child (ID or pubkey) to an existing group's children list.
 *
 * @param {string} groupID ID of group to modify
 * @param {string} childID ID of child to add
 * @returns {Object}
 *
 * @private
 */
function addChild(groupID, childID) {
  return updateChildren(groupID, childID, (childID, newChildren) => {
    // deduplicate: only add parentID if doesn't already exist in list
    if (newChildren.indexOf(childID) === -1) newChildren.push(childID);
    return newChildren;
  });
}

/**
 * Removes a child (ID or pubkey) from an existing group's children list.
 * Noop if child did not exist in the children list.
 *
 * @param {string} groupID ID of group to modify
 * @param {string} childID ID of child to remove
 * @returns {Object}
 *
 * @private
 */
function removeChild(groupID, childID) {
  return updateChildren(groupID, childID, (childID, newChildren) => {
    let idx = newChildren.indexOf(childID);
    if (idx !== -1) newChildren.splice(idx, 1);
    return newChildren;
  });
}

/**
 * Helper function for updating existing group's children list.
 *
 * @param {string} groupID ID of group to modify
 * @param {string} childID ID of child to add/remove
 * @param {callback} callback operation to perform on the childrens list
 * @returns {Object}
 *
 * @private
 */
function updateChildren(groupID, childID, callback) {
  let oldGroupValue = getGroup(groupID);
  let newChildren = callback(childID, oldGroupValue.children);
  let newGroupValue = { ...oldGroupValue, children: newChildren };
  setGroup(groupID, newGroupValue);
  return newGroupValue;
}

/**
 * Gets parents list of group with groupID.
 *
 * @param {string} groupID ID of group whose parents list to get
 * @returns {string[]}
 *
 * @private
 */
function getParents(groupID) {
  return getGroup(groupID)?.parents ?? [];
}

/**
 * Adds an additional parent (ID) to an existing group's parents list.
 *
 * @param {string} groupID ID of group to modify
 * @param {string} parentID ID of parent to add
 * @returns {Object}
 *
 * @private
 */
function addParent({ groupID, parentID }) {
  return updateParents(groupID, parentID, (parentID, newParents) => {
    // deduplicate: only add parentID if doesn't already exist in list
    if (newParents.indexOf(parentID) === -1) newParents.push(parentID);
    return newParents;
  });
}

/**
 * Removes a parent (ID or pubkey) from an existing group's parents list.
 * Noop if parent did not exist in the parent list.
 *
 * @param {string} groupID ID of group to modify
 * @param {string} parentID ID of parent to remove
 * @returns {Object}
 *
 * @private
 */
function removeParent(groupID, parentID) {
  return updateParents(groupID, parentID, (parentID, newParents) => {
    let idx = newParents.indexOf(parentID);
    if (idx !== -1) newParents.splice(idx, 1);
    return newParents;
  });
}

/**
 * Helper function for updating existing group's parents list.
 *
 * @param {string} groupID ID of group to modify
 * @param {string} parentID ID of parent to add/remove
 * @param {callback} callback operation to perform on the parents list
 * @returns {Object}
 *
 * @private
 */
function updateParents(groupID, parentID, callback) {
  let oldGroupValue = getGroup(groupID);
  let newParents = callback(parentID, oldGroupValue.parents);
  let newGroupValue = { ...oldGroupValue, parents: newParents };
  setGroup(groupID, newGroupValue);
  return newGroupValue;
}

/**
 * Group getter.
 *
 * @param {string} groupID ID of group to get
 * @returns {Object}
 *
 * @private
 */
function getGroup(groupID) {
  return db.get(getDataKey(GROUP, groupID));
}

/*
 * Group name getter
 */
//function getGroupName(groupID) {
//  let group = getGroup(groupID);
//  if (group !== null) {
//    return group.name;
//  }
//  return null;
//}

/**
 * Group setter.
 *
 * @param {string} groupID ID of group to set
 * @param {Object} groupValue value to set group to
 *
 * @private
 */
function setGroup(groupID, groupValue) {
  db.set(getDataKey(GROUP, groupID), groupValue);
}

/**
 * Group remover.
 *
 * @param {string} groupID ID of group to remove
 *
 * @private
 */
function removeGroup(groupID) {
  db.remove(getDataKey(GROUP, groupID));
}

/**
 * Linked group getter.
 *
 * @returns {string[]}
 */
export function getLinkedDevices() {
  return resolveIDs([LINKED]);
}

/*
 ************
 * Data API *
 ************
 */

/**
 * Get storage key for item given prefix and id.
 *
 * @params {string} prefix key prefix (GROUPS or app-specific)
 * @params {string} id auto-incremented id
 * @returns {string}
 *
 * @private
 */
function getDataKey(prefix, id) {
  return DATA + SLASH + prefix + SLASH + id + SLASH;
}

// TODO doc
function getDataPrefix(prefix) {
  return DATA + SLASH + prefix + SLASH;
}

/**
 * Generates ID for data value, resolves the full key given the prefix, 
 * adds group information, stores value and sends to other devices
 * in the group to also store.
 *
 * @params {string} prefix prefix name
 * @params {Object} data app-specific data object
 * @params {string} id app-specific object id
 */
export function setData(prefix, id, data) {
  let key = getDataKey(prefix, id);
  let value = {
    groupID: LINKED,
    data: data,
  };
  db.set(key, value);
  // send to other devices in groupID
  sendMessage(resolveIDs([LINKED]), {
    msgType: UPDATE_DATA,
    key: key,
    value: value,
  });
}

// TODO doc

// TODO pros/cons of maximum only allowing one prefix at a time?
// if have to call this func for every prefix, thats a lot of iterations
// (or is it?)
export function getData(prefix, id = null) {
  if (id === null) {
    // get all data within prefix
    let results = [];
    let intermediate = db.getMany(getDataPrefix(prefix));
    intermediate.forEach(({ key, value }) => {
      results.push({
        id: key.split(SLASH)[2],
        data: value.data,
      });
    });
    return results;
  } else {
    // get single data item
    return db.get(getDataKey(prefix, id))?.data ?? null;
  }
}

// need app-specific ID if app wants to be able to name/address data (and thus 
// share it or delete it). Maybe can also expose frida IDs if app wants to use
// them? But this may require more change than necessary on developer-side
//export function removeData(prefix, id) {}

/**
 * Stores data value at data key (where data value has group information).
 *
 * @params {string} key data key
 * @params {Object} value data value
 *
 * @private
 */
function updateData({ key, value }) {
  db.set(key, value);
}

// TODO move up
export function updateGroups(prefix, id, groupID) {
  if (getGroup(groupID) === null) {
    return;
  }

  let curGroup = db.get(getDataKey(prefix, id))?.groupID ?? null;
  if (curGroup !== null) {
    console.log(curGroup);
    let newGroupID = crypto.randomUUID();
    createGroup(newGroupID, null, [], [curGroup, groupID]);
    addParent({ groupID: curGroup, parentID: newGroupID });
    addParent({ groupID: groupID, parentID: newGroupID });
    let newGroupValue = getGroup(newGroupID);
    
    /* UPDATE SELF */
    let restExistingPubkeys = resolveIDs([curGroup]);
    sendMessage(restExistingPubkeys, {
      msgType: NEW_GROUP,
      id: newGroupID,
      value: newGroupValue,
    });
    sendMessage(restExistingPubkeys, {
      msgType: ADD_PARENT,
      groupID: curGroup,
      parentID: newGroupID,
    });
    sendMessage(restExistingPubkeys, {
      msgType: ADD_PARENT,
      groupID: groupID,
      parentID: newGroupID,
    });

    /* UPDATE OTHER */
    if (curGroup === LINKED) {
      curGroup = getGroup(LINKED).name;
    }
    let newMemberPubkeys = resolveIDs([groupID]);
    sendMessage(newMemberPubkeys, {
      msgType: NEW_GROUP,
      id: newGroupID,
      value: newGroupValue,
    });
    // TODO can't just add parents, don't know what groups exist on other devices
  }
}

/*
 *****************************
 * Cryptographic Key Helpers *
 *****************************
 */

/**
 * Public key getter.
 *
 * @returns {string}
 */
export function getPubkey() {
  return db.get(PUBKEY);
}

/**
 * Public key setter.
 *
 * @param {string} pubkey hex-formatted public key to set as device's public key
 *
 * @private
 */
function setPubkey(pubkey) {
  db.set(PUBKEY, pubkey);
}

/**
 * Private key getter.
 *
 * @returns {string}
 *
 * @private
 */
function getPrivkey() {
  return db.get(PRIVKEY);
}

/**
 * Private key setter.
 *
 * @param {string} privkey hex-formatted private key to set as device's private key
 *
 * @private
 */
function setPrivkey(privkey) {
  db.set(PRIVKEY, privkey);
}
