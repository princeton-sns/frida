/*
 ********
 * Core *
 ********
 */

import * as sc from "./serverComm/socketIO.js";
import * as c from "./crypto/libSodium.js";
import * as db from "./db/localStorage.js";

/* Local variables */

const SLASH = "/";
const DATA  = "__data";
const GROUP = "__group";
const GROUP_KEY_PREFIX = DATA + SLASH + GROUP + SLASH;
const LINKED = "__linked";
const GROUP_TYPE = "group_type";
const PK_TYPE    = "pubkey_type";
const PUBKEY   = "pubkey";
const PRIVKEY  = "privkey";
// valid message types
const REQ_LINK = "requestLink";
const LINK     = "link";
const DELETE   = "delete";

export {GROUP_KEY_PREFIX as groupPrefix};
//export {db};

// default auth/unauth functions do nothing
let onAuth = () => {};
let onUnauth = () => {};

// default callback
let defaultValidateCallback = (payload) => {
  console.log("validating payload...");
  console.log(payload)
};
let validateCallback = defaultValidateCallback;

// default group structure
//let defaultGroupFields = {
//  key: "ID",
//  list: "members", // => without the "type" field, leaf nodes can be those with empty lists
//  // type: "type", => would be used to distinguish group/pubkey types
//};
//let groupFields = defaultGroupFields;

/* Function definitions */

/*
 * Initializes client-server connection
 *
 * ip: string
 * port: string
 * config: object
 *   onAuth: func
 *   onUnauth: func
 *   validateCallback: func
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
}

/*
 * Sets the callback function to use upon authentication
 *
 * func: function
 */
export function setOnAuthFunc(func) {
  onAuth = func;
}

/*
 * Sets the callback function to use upon unauthentication
 *
 * func: function
 */
export function setOnUnauthFunc(func) {
  onUnauth = func;
}

/*
 * Sets the callback function with which to perform message validation
 *   for this application
 *
 * newValidateCallback: function
 *
 * TODO validate newValidateCallback to ensure it only takes one argument
 *   (the payload)
 */
export function setValidateCallback(callback) {
  validateCallback = callback;
}

/*
 * Connects the device to the server, e.g. when a client adds a new
 *   device or when a previously-added device comes back online
 *
 * pubkey: string
 */
export function connectDevice(pubkey = null) {
  if (pubkey !== null) {
    sc.connect(pubkey);
  } else {
    sc.connect(getPubkey());
  }
}

/*
 * Simulates offline devices
 */
export function disconnectDevice() {
  sc.disconnect(getPubkey());
}

/*
 * Called like: sendMessage(resolveIDs(id), payload)
 * See example in deleteAllLinkedDevices()
 *
 * dstPubkeys: list of strings
 * payload: object
 *
 * TODO better to take in the current device's pub/priv-keys as arguments? 
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
      toString(payload)
    );
    batch.push({
      dstPubkey: dstPubkey,
      encPayload: encPayload,
      nonce: nonce,
    });
  });

  let msg = {
    srcPubkey: srcPubkey,
    batch: batch,
  };

  // send message to server
  sc.sendMessage(msg);
}

/*
 * Decrypts, validates, and demultiplexes the received message
 *
 * msg: encrypted string
 *
 * TODO consider: expose ordered or unordered message reception?
 *   E.g. ordered may be simpler to program against but maybe 
 *   real-time apps would benefit from an unordered API (perhaps
 *   make this composable?)
 */
export function onMessage(msg) {
  console.log("seqID: " + msg.seqID);

  let curPrivkey = getPrivkey();
  let payload = fromString(
    c.decryptAndVerify(
      msg.encPayload,
      msg.nonce,
      msg.srcPubkey,
      curPrivkey
    )
  );

  // validate via callback
  validate(payload);

  switch (payload.msgType) {
    case REQ_LINK:
      processRequestLink(payload.newDeviceID, payload.newDeviceName, payload.newDevicePubkey);
      break;
    case LINK:
      processLink(payload.linkedGroup, payload.existingDevices);
      break;
    case DELETE:
      deleteDevice();
      break;
    default: 
      console.log("ERROR UNKNOWN msgType: " + payload.msgType);
  }
}

/*
 * Resolves the ID(s) passed in to a list of one or more public keys
 *
 * ids: list
 */
export function defaultResolveIDs(ids) {
  let pubkeys = [];
  ids.forEach((id) => {
    let groupValue = getGroup(id);
    // FIXME `type` field is group-structure-specific
    if (groupValue.type == GROUP_TYPE) {
      pubkeys = pubkeys.concat(defaultResolveIDs(groupValue.members));
    } else {
      pubkeys = pubkeys.concat(groupValue.members);
    }
  });
  return pubkeys;
}

// GROUP AGNOSTIC
let resolveIDs = defaultResolveIDs;

export function setResolveIDs(callback) { 
  // TODO validate 1 arg
  resolveIDs = callback;
}

/*
 * Validates a message via the validateCallback, which can either be:
 * 1. defined by the application (through setValidateCallback()), or
 * 2. the default callback (defaultValidateCallback)
 *
 * payload: decrypted string
 */
function validate(payload) {
  validateCallback(payload);
}

/*
 * Wrapper function for assigning a group key to a group value consisting
 *   of a name, type, and members list
 *
 * ID: string (unique)
 * name: string (human-readable name; optional)
 * type: one of GROUP_TYPE or PUBKEY_TYPE
 * members: list of strings
 *   if type is GROUP_TYPE, each string should be an ID
 *   else if type is PUBKEY_TYPE, each string should be a pubkey (hex-formatted)
 */
function defaultCreateGroup(ID, name, type, members) {
  setGroup(
    ID,
    {
      name: name,
      type: type,
      members: members,
    }
  );
}

// GROUP AGNOSTIC
let createGroup = defaultCreateGroup;

export function setCreateGroup(callback) {
  // TODO validate? how?
  createGroup = callback;
}

/*
 * Adds an additional member (ID or pubkey) to an existing group's member list
 *
 * groupID: string (unique)
 * memberID: string (unique)
 */
function defaultAddGroupMember(groupID, memberID) {
  let oldGroupValue = getGroup(groupID);
  let newMembers = oldGroupValue.members;
  newMembers.push(memberID);
  let newGroupValue = {
    name: oldGroupValue.name,
    type: oldGroupValue.type,
    members: newMembers,
  }
  setGroup(groupID, newGroupValue);
  return newGroupValue;
}

// GROUP AGNOSTIC
let addGroupMember = defaultAddGroupMember;

export function setAddGroupMember(callback) {
  // TODO validate 2 args
  addGroupMember = callback;
}

/*
 * Initializes a new device with a keypair and adds the public key to the
 *   server
 *
 * deviceID: string (unique)
 * deviceName: string (human-readable name; optional)
 */
function initDevice(deviceID, deviceName) {
  let deviceKeys = c.generateKeypair();
  setPubkey(deviceKeys.pubkey);
  setPrivkey(deviceKeys.privkey);
  sc.addDevice(deviceKeys.pubkey);
  connectDevice(deviceKeys.pubkey);
  createGroup(deviceID, deviceName, PK_TYPE, [deviceKeys.pubkey]);
  return deviceKeys.pubkey;
}

/*
 * Initializes device and its linked group
 *
 * linkedName: string (human-readable name; for contacts)
 * deviceName: string (human-readable name; optional)
 *
 * TODO better choice than setting deviceName = deviceID if null?
 */
export function createDevice(linkedName = null, deviceName = null) {
  // if linkedName is null, generate a random one (anonymity?)
  if (linkedName === null) {
    linkedName = crypto.randomUUID();
  }
  let deviceID = crypto.randomUUID();
  if (deviceName === null) {
    deviceName = deviceID;
  }
  let pubkey = initDevice(deviceID, deviceName);
  createGroup(LINKED, linkedName, GROUP_TYPE, [deviceID]);
  onAuth();
  return pubkey;
}

/*
 * Initializes device without a linked group, and requests linked
 *   group information from the supplied public key
 *
 * dstPubkey: string (hex-formatted)
 * deviceName: string (human-readable; optional)
 *
 * TODO better choice than setting deviceName = deviceID if null?
 */
export function createLinkedDevice(dstPubkey, deviceName = null) {
  if (dstPubkey !== null) {
    let deviceID = crypto.randomUUID();
    if (deviceName === null) {
      deviceName = deviceID;
    }
    let pubkey = initDevice(deviceID, deviceName);
    // construct message that asks dstPubkey's corresponding device to
    // link this device
    let payload = {
      msgType: REQ_LINK,
      newDevicePubkey: getPubkey(),
      newDeviceName: deviceName,
      newDeviceID: deviceID,
    };
    sendMessage([dstPubkey], payload);
    return pubkey;
  }
}

/*
 * Creates a new group for the requesting device, adds the new group ID to the 
 *   current device's linked group, and send the requesting device the list of 
 *   and group information of any existing devices (including the current one)
 *
 * newDeviceID: string (unique)
 * newDeviceName: string (human-readable name; optional)
 * newDevicePubkey: string (hex-formatted)
 * 
 * TODO send other data from this device
 *   - contacts?
 *   - app data?
 */
function processRequestLink(newDeviceID, newDeviceName, newDevicePubkey) {
  if (confirm(`Authenticate new device?\n\tName: ${newDeviceName}\n\tPubkey: ${newDevicePubkey}`)) {
    // get all existing device groups to send to new device
    let existingDevices = [];
    let members = getMembers(LINKED);
    members.forEach((memberID) => {
      existingDevices.push({
        ID: memberID,
        group: getGroup(memberID),
      });
    });

    // create group for new device
    createGroup(newDeviceID, newDeviceName, PK_TYPE, [newDevicePubkey]);

    // add new device to linked group
    let updatedGroup = addGroupMember(LINKED, newDeviceID);

    let payload = {
      msgType: LINK,
      linkedGroup: updatedGroup,
      existingDevices: existingDevices,
    };
    sendMessage([newDevicePubkey], payload);
  }
}

/*
 * Updates linked group info and and group info for all devices that are members
 *   of the linked group
 *
 * linkedGroup: object
 * existingDevices: list
 *
 * TODO also process any other data sent from the device being linked with
 */
function processLink(linkedGroup, existingDevices) {
  setGroup(LINKED, linkedGroup);
  existingDevices.forEach(({ ID, group }) => {
    setGroup(ID, group);
  });
  onAuth();
}

/*
 * Deletes the current device's data and removes it's public key from 
 *   the server
 */
export function deleteDevice() {
  let pubkey = getPubkey();
  sc.removeDevice(pubkey);
  sc.disconnect(pubkey);
  db.clear();
  onUnauth();
}

/*
 * Deletes all devices that are members of this device's linked group
 */
export function deleteAllLinkedDevices() {
  let payload = {
    msgType: DELETE,
  };
  sendMessage(resolveIDs([LINKED]), payload);
}

/*
 ***********
 * Helpers *
 ***********
 */

/*
 * Pubkey getter
 */
export function getPubkey() {
  return db.get(PUBKEY);
}

/*
 * Pubkey setter
 */
function setPubkey(pubkey) {
  db.set(PUBKEY, pubkey);
}

/*
 * Privkey getter
 */
function getPrivkey() {
  return db.get(PRIVKEY);
}

/*
 * Privkey setter
 */
function setPrivkey(privkey) {
  db.set(PRIVKEY, privkey);
}

/*
 * Gets full-length groupKey
 *
 * groupID: unique string
 */
function getGroupKey(groupID) {
  return GROUP_KEY_PREFIX + groupID + SLASH;
}

/*
 * Group getter
 */
function getGroup(groupID) {
  return db.get(getGroupKey(groupID));
}

/*
 * Group setter
 */
function setGroup(groupID, groupValue) {
  db.set(getGroupKey(groupID), groupValue);
}

/*
 * Accessor for 'members' field of group
 */
function defaultGetMembers(groupID) {
  return getGroup(groupID).members;
}

// GROUP AGNOSTIC
let getMembers = defaultGetMembers;

export function setGetMembers(callback) {
  // TODO validate 1 arg
  getMembers = callback;
}

/*
 * linkedGroup getter
 */
export function defaultGetLinkedDevices() {
  let linkedGroup = getGroup(LINKED);
  if (linkedGroup !== null) {
    return resolveIDs(linkedGroup.members);
  } else {
    return [];
  }
}

// GROUP AGNOSTIC
export let getLinkedDevices = defaultGetLinkedDevices;

export function setGetLinkedDevices(callback) {
  // TODO validate 0 args
  getLinkedDevices = callback;
}

/*
 * JSON wrapper helpers for DB
 */
export function toString(obj) {
  return JSON.stringify(obj);
}

export function fromString(str) {
  return JSON.parse(str);
}
