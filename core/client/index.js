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
const UPDATE_GROUP          = "updateGroup";
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
  [UPDATE_GROUP]:          updateGroup,
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

function createDBListenerPlugin() {
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

export { createDBListenerPlugin as dbListenerPlugin };

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
 * @param {?string} linkedName human-readable name (for contacts)
 * @param {?string} deviceName human-readable name (for self)
 * @returns {string}
 *
 * @private
 */
function initDevice(linkedName = null, deviceName = null) {
  let { pubkey, privkey } = c.generateKeypair();
  setPubkey(pubkey);
  setPrivkey(privkey);
  sc.addDevice(pubkey);
  connectDevice(pubkey);

  // enforce that linkedName exists; deviceName is not necessary
  if (linkedName === null) {
    linkedName = crypto.randomUUID();
  }
  createGroup(LINKED, linkedName, [], [linkedName]);
  createGroup(linkedName, null, [LINKED], [pubkey]);
  createKey(pubkey, deviceName, [linkedName]);

  createGroup(CONTACTS, null, [], []);

  return {
    pubkey: pubkey,
    linkedName: linkedName,
  };
}

/**
 * Initializes device and its linked group.
 *
 * @param {?string} linkedName human-readable name (for contacts)
 * @param {?string} deviceName human-readable name (for self)
 * @returns {string}
 */
export function createDevice(linkedName = null, deviceName = null) {
  let { pubkey } = initDevice(linkedName, deviceName);
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
    let { pubkey, linkedName } = initDevice(null, deviceName);
    let linkedMembers = getAllSubgroups([linkedName]);
    console.log(linkedMembers);
    // construct message that asks dstPubkey's device to link this device
    sendMessage([dstPubkey], {
      msgType: REQ_UPDATE_LINKED,
      tempName: linkedName,
      srcPubkey: pubkey,
      newLinkedMembers: linkedMembers,
    });
    return pubkey;
  }
}

/**
 * Randomly generates a new group ID.
 *
 * @returns {string}
 *
 * @private
 */
function getNewGroupID() {
  return crypto.randomUUID();
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
 * @param {string} tempName temporary name of device requesting to link
 * @param {string} srcPubkey pubkey of device requesting to link
 * @param {Object[]} newLinkedMembers linked subgroups of device requesting to link
 *
 * @private
 */
function processUpdateLinkedRequest({ tempName, srcPubkey, newLinkedMembers }) {
  if (confirm(`Authenticate new LINKED group member?\n\tName: ${tempName}`)) {
    // get rest of linked pubkeys to update
    let pubkey = getPubkey();
    let restLinkedPubkeys = resolveIDs([LINKED]).filter((x) => x != pubkey);
    let linkedName = getLinkedName();

    /* UPDATE OLD SELF */

    // replace all occurrences of tempName with linkedName
    let updatedNewLinkedMembers = [];
    newLinkedMembers.forEach((newGroup) => {
      if (newGroup.id === tempName) {
        updatedNewLinkedMembers.push({
          ...newGroup,
          id: linkedName,
        });
      } else if (newGroup.value.parents.includes(tempName)) {
        let updatedParents = newGroup.value.parents.filter((x) => x != tempName);
        updatedParents.push(linkedName);
        updatedNewLinkedMembers.push({
          ...newGroup,
          value: {
            ...newGroup.value,
            parents: updatedParents,
          },
        });
      } else if (newGroup.value.children.includes(tempName)) {
        let updatedChildren = newGroup.value.children.filter((x) => x != tempName);
        updatedChildren.push(linkedName);
        updatedNewLinkedMembers.push({
          ...newGroup,
          value: {
            ...newGroup.value,
            children: updatedChildren,
          },
        });
      } else {
        updatedNewLinkedMembers.push(newGroup);
      }
    });

    updatedNewLinkedMembers.forEach((newGroup) => {
      // FIXME assuming this group ID == linkedName (originally tempName)
      // when would this be false??
      if (newGroup.value.parents.includes(LINKED)) {
        // merge with existing linkedName group
        let nonLinkedParents = newGroup.value.parents.filter((x) => x != LINKED);
        nonLinkedParents.forEach((nonLinkedParent) => {
          addParent({ groupID: linkedName, parentID: nonLinkedParent });
        });
        newGroup.value.children.forEach((child) => {
          addChild(linkedName, child);
        });
        sendMessage(restLinkedPubkeys, {
          msgType: UPDATE_GROUP,
          id: linkedName,
          value: getGroup(linkedName),
        });
      } else {
        updateGroup({ id: newGroup.id, value: newGroup.value });
        sendMessage(restLinkedPubkeys, {
          msgType: UPDATE_GROUP,
          id: newGroup.id,
          value: newGroup.value,
        });
      }
    });

    /* UPDATE NEW SELF */

    // notify new group member successful link and piggyback existing group info
    sendMessage([srcPubkey], {
      msgType: DELETE_GROUP,
      groupID: tempName,
    });
    sendMessage([srcPubkey], {
      msgType: CONFIRM_UPDATE_LINKED,
      existingSubgroups: getAllSubgroups([LINKED, CONTACTS]),
    });

    /* UPDATE OTHER */

    // notify contacts
    let contactPubkeys = resolveIDs([CONTACTS]);
    // FIXME inefficient, calling this function twice
    let contactGroups = getAllSubgroups([linkedName]);
    contactGroups.forEach((contactGroup) => {
      sendMessage(contactPubkeys, {
        msgType: UPDATE_GROUP,
        id: contactGroup.id,
        value: contactGroup.value,
      });
    });
  }
}

/**
 * Updates linked group info and and group info for all devices that are 
 * children of the linked group.
 *
 * TODO also process any other data sent from the device being linked with.
 *
 * @param {Object[]} existingSubgroups existing groups on linked device
 *
 * @private
 */
function confirmUpdateLinked({ existingSubgroups }) {
  existingSubgroups.forEach(({ id, value }) => {
    setGroup(id, value);
  });
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
 * Updates group with new value.
 *
 * @param {string} id group ID
 * @param {Object} value group value
 * 
 * @private
 */
function updateGroup({ id, value }) {
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
  let linkedName = getLinkedName();
  sendMessage([contactPubkey], {
    msgType: REQ_CONTACT,
    reqContactName: linkedName,
    reqContactGroups: getAllSubgroups([linkedName]),
  });
}

/**
 * Asks user if contact exchange should be accepted, and if so processes
 * and stores the requesting party's contact info and sends back own 
 * contact info.
 *
 * @param {string} reqContactName requesting party's linked name
 * @param {Object[]} reqContactGroups list of requesting party's linked subgroups
 *
 * @private
 */
function processRequestContact({ reqContactName, reqContactGroups }) {
  if (confirm(`Add new contact: ${reqContactName}?`)) {
    parseContactInfo(reqContactName, reqContactGroups);
    let linkedName = getLinkedName();
    sendMessage(resolveIDs([reqContactName]), {
      msgType: CONFIRM_CONTACT,
      contactName: linkedName,
      contactGroups: getAllSubgroups([linkedName]),
    });
  }
}

/**
 * Processes and stores the requested contact info.
 *
 * @param {string} contactName linked name of requested contact
 * @param {Object[]} contactGroups linked group information of requested contact
 *
 * @private
 */
function confirmContact({ contactName, contactGroups }) {
  parseContactInfo(contactName, contactGroups);
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
    updateGroup({
      id: contactGroup.id,
      value: contactGroup.value,
    });
    sendMessage(restLinkedPubkeys, {
      msgType: UPDATE_GROUP,
      id: contactGroup.id,
      value: contactGroup.value,
    });
  });

  linkGroups({
    parentID: CONTACTS,
    childID: contactName,
  });
  sendMessage(restLinkedPubkeys, {
    msgType: LINK_GROUPS,
    parentID: CONTACTS,
    childID: contactName,
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
        id: groupID,
        value: group,
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

/**
 * Get linked name.
 *
 * @returns {string}
 *
 * @private
 */
function getLinkedName() {
  return getGroup(LINKED).name;
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

/**
 * Get partial storage key for a particular data prefix.
 *
 * @param {string} prefix key prefix (app-specific)
 * @returns {string}
 *
 * @private
 */
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

/**
 * If only prefix is specified, gets a list of data objects whose keys begin
 * with that prefix, otherwise get a single data object.
 * TODO consider pros/cons of only processing one prefix at a time
 * (efficiency in cases where want data from more than one prefix).
 *
 * @params {string} prefix data prefix
 * @params {?string} id app-specific object id
 * @returns {Object|Object[]|null}
 */
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
    let newGroupID = getNewGroupID();
    createGroup(newGroupID, null, [], [curGroup, groupID]);
    addParent({ groupID: curGroup, parentID: newGroupID });
    addParent({ groupID: groupID, parentID: newGroupID });
    let newGroupValue = getGroup(newGroupID);
    
    /* UPDATE SELF */
    let restExistingPubkeys = resolveIDs([curGroup]);
    sendMessage(restExistingPubkeys, {
      msgType: UPDATE_GROUP,
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
      curGroup = getLinkedName();
    }
    let newMemberPubkeys = resolveIDs([groupID]);
    sendMessage(newMemberPubkeys, {
      msgType: UPDATE_GROUP,
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
