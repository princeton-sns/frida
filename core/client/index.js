/*
 ************
 ************
 *** Core ***
 ************
 ************
 */

// TODO thoughts: should permission checks happen at the
// database layer?
// e.g. any local database modifications should either be
// checked (it is possible they come from an external party)
// or unchecked (it is impossible for them to come from an
// external party)
// how hard is reasoning about this?

// TODO add permission checks for setting cryptographic keys?

import * as sc from "./serverComm/socketIO.js";
import * as c from  "./crypto/libSodium.js";
import * as db from "./db/localStorage.js";

export { db };

/* Local variables */

const SLASH = "/";
const DATA  = "__data";
const GROUP = "__group";
const LINKED   = "__linked";
const CONTACTS = "__contacts";
const PUBKEY   = "pubkey";
const PRIVKEY  = "privkey";
const OUTSTANDING_PUBKEY = "__outstandingPubkey";


// FIXME need new special name for LINKED group (confusing when linking non-LINKED groups)

// TODO implement a way for clients to check permissions and revert action before
// it is propagated, e.g. if well-intentioned clients make a mistake don't want
// to result in inconsistent state

// valid message types
const REQ_UPDATE_LINKED     = "requestUpdateLinked";
const CONFIRM_UPDATE_LINKED = "confirmUpdateLinked";
const LINK_GROUPS           = "linkGroups";
const ADD_PARENT            = "addParent";
const REMOVE_PARENT         = "removeParent";
const ADD_CHILD             = "addChild";
const ADD_WRITER            = "addWriter";
const ADD_ADMIN             = "addAdmin";
const NEW_GROUP             = "newGroup";
const UPDATE_GROUP          = "updateGroup"; // only used within LINKED group
const DELETE_SELF           = "deleteSelf";
const DELETE_GROUP          = "deleteGroup";
const REQ_CONTACT           = "requestContact";
const CONFIRM_CONTACT       = "confirmContact";
const UPDATE_DATA           = "updateData";
const DELETE_DATA           = "deleteData";

// demultiplexing map from message types to functions
const demuxMap = {
  [REQ_UPDATE_LINKED]:     processUpdateLinkedRequest,
  [CONFIRM_UPDATE_LINKED]: confirmUpdateLinked,
  [LINK_GROUPS]:           linkGroups,
  [ADD_PARENT]:            addParent,
  [REMOVE_PARENT]:         removeParent,
  [ADD_CHILD]:             addChild,
  [ADD_WRITER]:            addWriter,
  [ADD_ADMIN]:             addAdmin,
  [NEW_GROUP]:             updateGroup,
  [UPDATE_GROUP]:          updateGroup,
  [DELETE_SELF]:           deleteDevice,
  [DELETE_GROUP]:          deleteGroup,
  [REQ_CONTACT]:           processRequestContact,
  [CONFIRM_CONTACT]:       confirmContact,
  [UPDATE_DATA]:           updateData,
  [DELETE_DATA]:           deleteData,
};

export { PUBKEY as pubkeyPrefix };

// default auth/unauth functions do nothing
let defaultOnAuth   = () => {};
let defaultOnUnauth = () => {};

// default callback
let defaultValidateCallback = (payload) => {
  console.log("validating payload...");
  console.log(payload)
  return true;
}

// init options
let storagePrefixes = [GROUP];
let onAuth;
let onUnauth;
let validateCallback;
let encrypt;

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
const Key   = makeGroup("name parents admins writers");
// readers list isn't necessary, any member that isn't an admin
// or writer can be assumed to be a reader
// TODO also deduplicate admins and writers (any writer who is also an
// admin can _just_ exist in the admin group, since admin abilities are a
// superset of writer abilities
const Group = makeGroup("name parents children admins writers");

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

/* Error messages */

function printBadMessageError(msgType) {
  console.log("----------ERROR unknown msgType: " + msgType);
}

function printBadPermissionsError() {
  console.log("----------ERROR insufficient permissions");
}

function printBadDataError() {
  console.log("----------ERROR data invariant violated");
}

function printBadContactError() {
  console.log("----------ERROR cannot add self as contact");
}

function printBadDataPermissionsError() {
  console.log("----------ERROR insufficient permissions for modifying data");
}

function printBadGroupPermissionsError() {
  console.log("----------ERROR insufficient permissions for modifying group");
}

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
  onAuth = config.onAuth ?? defaultOnAuth;
  onUnauth = config.onUnauth ?? defaultOnUnauth;
  validateCallback = config.validateCallback ?? defaultValidateCallback;
  encrypt = config.encrypt ?? true;
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
 * @param {string[]} dstPubkeys public keys to send message to
 * @param {Object} payload message contents
 *
 * @private
 */
function sendMessage(dstPubkeys, payload) {
  let batch = new Array();
  let srcPubkey = getPubkey();
  let srcPrivkey = getPrivkey();

  dstPubkeys.forEach(dstPubkey => {
    // encrypt payload separately for each destination 
    let { ciphertext: encPayload, nonce: nonce } = c.signAndEncrypt(
      dstPubkey,
      srcPrivkey,
      db.toString(payload),
      encrypt
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
 * TODO make private to module instead of exporting fully.
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
        curPrivkey,
        encrypt
      )
    );

    let { permissionsOK, demuxFunc } = checkPermissions(payload, msg.srcPubkey);
    if (demuxFunc === undefined) {
      printBadMessageError(payload.msgType);
      return;
    }
    if (!permissionsOK) {
      printBadPermissionsError();
      return;
    }
    if (!validate(payload)) {
      printBadDataError();
      return;
    }
    console.log("SUCCESS");
    demuxFunc(payload);
  }
}

/**
 * Resolves a list of one or more group IDs to a list of public keys.
 *
 * @param {string[]} ids group IDs to resolve
 * @return {string[]}
 *
 * @private
 */
function resolveIDs(ids) {
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
  createGroup(LINKED, linkedName, [], [linkedName], [linkedName], [linkedName]);
  createGroup(linkedName, null, [LINKED], [pubkey], [linkedName], [linkedName]);
  createKey(pubkey, deviceName, [linkedName], [linkedName], [linkedName]);

  createGroup(CONTACTS, null, [], [], [linkedName], [linkedName]);

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
    // construct message that asks dstPubkey's device to link this device
    setOutstandingLinkPubkey(dstPubkey);
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
 * Helper that sets temporary state to help with permission checks when
 * the current device has requested to be linked with another.
 *
 * @param {string} pubkey pubkey to link with and from which additional/updated
 *   group information will come (and which this device should thus allow)
 *
 * @private
 */
function setOutstandingLinkPubkey(pubkey) {
  db.set(OUTSTANDING_PUBKEY, pubkey);
}

/**
 * Helper for retrieving temporary state to help with permission checks when
 * the current device has requested to be linked with another.
 *
 * @returns {string} the pubkey with which this device has requested to link
 *
 * @private
 */
function getOutstandingLinkPubkey() {
  return db.get(OUTSTANDING_PUBKEY);
}

/**
 * Clears temporary state.
 *
 * @private
 */
function removeOutstandingLinkPubkey() {
  db.remove(OUTSTANDING_PUBKEY);
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
      updatedNewLinkedMembers.push(groupReplace(newGroup, tempName, linkedName));
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
          addChild({ groupID: linkedName, childID: child });
        });
        sendMessage(restLinkedPubkeys, {
          msgType: UPDATE_GROUP,
          groupID: linkedName,
          value: getGroup(linkedName),
        });
      } else {
        updateGroup({ groupID: newGroup.id, value: newGroup.value });
        newGroupHelper(newGroup.id, newGroup.value, restLinkedPubkeys);
      }
    });

    /* UPDATE NEW SELF */

    // delete old linkedName group
    sendMessage([srcPubkey], {
      msgType: DELETE_GROUP,
      groupID: tempName,
    });
    // notify new group member of successful link and piggyback existing group info
    sendMessage([srcPubkey], {
      msgType: CONFIRM_UPDATE_LINKED,
      existingSubgroups: getAllGroups(),
    });
    // send existing data to new linked group member
    let dataArr = getData();
    dataArr.forEach((dataElem) => {
      sendMessage([srcPubkey], {
        msgType: UPDATE_DATA,
        key: dataElem.key,
        value: dataElem.value,
      });
    });

    /* UPDATE OTHER */

    // notify contacts
    let contactPubkeys = resolveIDs([CONTACTS]);
    let contactNames = getChildren(CONTACTS);
    updatedNewLinkedMembers.forEach((newGroup) => {
      if (newGroup.id === linkedName) {
        newGroup.value.children.forEach((child) => {
          sendMessage(contactPubkeys, {
            msgType: ADD_CHILD,
            groupID: linkedName,
            childID: child,
          });
        });
      } else {
        contactNames.forEach((contactName) => {
          newGroupHelper(newGroup.id, addAdmin({ groupID: newGroup.id, adminID: contactName }), resolveIDs([contactName]));
        });
      }
    });
  }
}

/**
 * Helper function that replaces (in place) the specified ID in the specified 
 * group field with another ID, modifying the group data in place.
 *
 * @param {string} key name of group field to update
 * @param {Object} fullGroup actual group to modify
 * @param {string} IDToReplace id to replace
 * @param {string} replacementID replacement id
 *
 * @private
 */
function groupReplaceHelper(key, fullGroup, IDToReplace, replacementID) {
  if (fullGroup.value[key]?.includes(IDToReplace)) {
    let updated = fullGroup.value[key].filter((x) => x != IDToReplace);
    updated.push(replacementID);
    fullGroup.value = {
      ...fullGroup.value,
      [key]: updated,
    };
  }
}

/**
 * Replaces specified ID with another ID in all fields of a group.
 *
 * @param {Object} group group to modify
 * @param {string} IDToReplace id to replace
 * @param {string} replacementID replacement id
 * @returns {Object} new group with all instances of IDToReplace replaced with
 *   replacementID
 *
 * @private
 */
function groupReplace(group, IDToReplace, replacementID) {
  let updatedGroup = group;
  if (group.id === IDToReplace) {
    updatedGroup = {
      ...updatedGroup,
      id: replacementID,
    };
  }
  groupReplaceHelper("parents", updatedGroup, IDToReplace, replacementID);
  groupReplaceHelper("children", updatedGroup, IDToReplace, replacementID);
  groupReplaceHelper("admins", updatedGroup, IDToReplace, replacementID);
  groupReplaceHelper("writers", updatedGroup, IDToReplace, replacementID);
  return updatedGroup;
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
  existingSubgroups.forEach(({ key, value }) => {
    db.set(key, value);
  });
  removeOutstandingLinkPubkey();
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
  return addChild({ groupID: parentID, childID: childID });
}

/**
 * Updates group with new value.
 *
 * @param {string} groupID group ID
 * @param {Object} value group value
 * 
 * @private
 */
function updateGroup({ groupID, value }) {
  setGroup(groupID, value);
}

function newGroupHelper(groupID, value, pubkeys) {
  sendMessage(pubkeys, {
    msgType: NEW_GROUP,
    groupID: groupID,
    value: value,
  });
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
  // only add contact if not self
  let linkedName = getLinkedName();
  if (!isMember(contactPubkey, [linkedName])) {
    // piggyback own contact info when requesting others contact info
    sendMessage([contactPubkey], {
      msgType: REQ_CONTACT,
      reqContactName: linkedName,
      reqContactGroups: getAllSubgroups([linkedName]),
    });
  } else {
    printBadContactError();
  }
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
  let linkedName = getLinkedName();
  let restLinkedPubkeys = resolveIDs([LINKED]).filter((x) => x != pubkey);

  contactGroups.forEach((contactGroup) => {
    let updatedContactGroup = groupReplace(contactGroup, LINKED, CONTACTS);
    // create group and add admin for enabling future deletion of this contact + groups
    addAdminInMem(updatedContactGroup.value, linkedName);
    updateGroup({
      groupID: updatedContactGroup.id,
      value: updatedContactGroup.value,
    });
    newGroupHelper(updatedContactGroup.id, updatedContactGroup.value, restLinkedPubkeys);
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
 */
export function deleteDevice() {
  // notify all direct parents and contacts that this group should be removed
  let pubkey = getPubkey();
  sendMessage(resolveIDs(getParents(pubkey).concat([CONTACTS])), {
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
    groupID: getLinkedName(),
  });
}

/**
 * Deletes all devices that are children of this device's linked group.
 */
export function deleteAllLinkedDevices() {
  sendMessage(resolveIDs([LINKED]), {
    msgType: DELETE_SELF,
    groupID: getLinkedName(),
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
    removeParent({ groupID: childID, parentID: groupID });
    // garbage collect any KEY group that no longer has any parents
    if (isKey(getGroup(childID)) && getParents(childID).length === 0) {
      removeGroup(childID);
    }
  });
  // delete group
  removeGroup(groupID);
  // TODO more GC (e.g. when contact's childrens list is empty -> remove contact)
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
function createGroup(ID, name, parents, children, admins, writers) {
  setGroup(ID, new Group(name, parents, children, admins, writers));
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
function createKey(ID, name, parents, admins, writers) {
  setGroup(ID, new Key(name, parents, admins, writers));
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
function addChild({ groupID, childID }) {
  return updateChildren(groupID, childID, (childID, newChildren) => {
    // deduplicate: only add parentID if doesn't already exist in list
    if (newChildren.indexOf(childID) === -1) newChildren.push(childID);
    return newChildren;
  });
}

function addChildHelper(groupID, childID, pubkeys) {
  addChild({ groupID: groupID, childID: childID });
  sendMessage(pubkeys, {
    msgType: ADD_CHILD,
    groupID: groupID,
    childID: childID,
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

function addParentHelper(groupID, parentID, pubkeys) {
  addParent({ groupID: groupID, parentID: parentID });
  sendMessage(pubkeys, {
    msgType: ADD_PARENT,
    groupID: groupID,
    parentID: parentID,
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
function removeParent({ groupID, parentID }) {
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
 * Get admins list of group.
 *
 * @param {string} groupID id of group whose admins list to get
 * @returns {string[]}
 *
 * @private
 */
function getAdmins(groupID) {
  return getGroup(groupID)?.admins ?? [];
}

/**
 * Gets the set of admins for a new group by getting the intersection of all
 * the admins lists of all parent groups (since adding this new group will 
 * presumably need to modify all parents).
 *
 * @param {string[]} groupIDs list of group ids to check across
 * @returns {string[]}
 *
 * @private
 */
function getAdminsMem(groupIDs) {
  let adminSet;
  groupIDs.forEach((groupID) => {
    if (adminSet === undefined) {
      adminSet = getAdmins(groupID);
    } else {
      adminSet = listIntersect(adminSet, getAdmins(groupID));
    }
  });
  return adminSet ?? []; 
}

/**
 * Adds admin to admins list of a group (modifies group in place).
 * TODO Necessary to do in-place? logic is if need to propagate this admins
 * list to contacts, will fail the check on contact devices b/c the device
 * that wants to modify the admins list to add itself is not yet an admin. 
 * But maybe the only "addAdmin" ops that need to be propagated are when
 * an existing admin adds a new admin (e.g. sharing data w admin privs).
 * => check all cases to see => not true, when adding contacts, cur device
 * adds self as admin + needs to propagate that to all linked devices
 *
 * @param {Object} oldGroupValue group value with admins list to update
 * @param {string} adminID id of admin to add
 *
 * @private
 */
function addAdminInMem(oldGroupValue, adminID) {
  // deduplicate: only add adminID if doesn't already exist in list
  if (oldGroupValue?.admins.indexOf(adminID) === -1) {
    oldGroupValue.admins.push(adminID);
  }
}

function addAdmin({ groupID, adminID }) {
  let oldGroupValue = getGroup(groupID);
  let newAdmins = oldGroupValue.admins;
  // deduplicate: only add adminID if doesn't already exist in list
  if (newAdmins?.indexOf(adminID) === -1) {
    newAdmins.push(adminID);
  }
  let newGroupValue = { ...oldGroupValue, admins: newAdmins };
  setGroup(groupID, newGroupValue);
  return newGroupValue;
}

function addAdminHelper(groupID, adminID, pubkeys) {
  addAdmin({ groupID: groupID, adminID: adminID });
  sendMessage(pubkeys, {
    msgType: ADD_ADMIN,
    groupID: groupID,
    adminID: adminID,
  });
}

/**
 * Gets writers list of group.
 *
 * @param {string} groupID id of group to get writers list of
 * @returns {string[]}
 *
 * @private
 */
function getWriters(groupID) {
  return getGroup(groupID)?.writers ?? [];
}

/**
 * Adds writer to writers list of a group (modifies group in place).
 *
 * @param {Object} oldGroupValue group value with admins list to update
 * @param {string} writerID id of writer to add
 *
 * @private
 */
function addWriter({ groupID, writerID }) {
  let oldGroupValue = getGroup(groupID);
  let newWriters = oldGroupValue.writers;
  // deduplicate: only add writerID if doesn't already exist in list
  if (newWriters?.indexOf(writerID) === -1) {
    newWriters.push(writerID);
  }
  let newGroupValue = { ...oldGroupValue, writers: newWriters };
  setGroup(groupID, newGroupValue);
  return newGroupValue;
}

function addWriterHelper(groupID, writerID, pubkeys) {
  addWriter({ groupID: groupID, writerID: writerID });
  sendMessage(pubkeys, {
    msgType: ADD_WRITER,
    groupID: groupID,
    writerID: writerID,
  });
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

function getAllGroups() {
  return db.getMany(getDataPrefix(GROUP));
}

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
export function getLinkedName() {
  return getGroup(LINKED)?.name ?? null;
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
 * Data API *
 ************
 */

/**
 * Get storage key for item given prefix and id.
 *
 * @param {string} prefix key prefix (GROUPS or app-specific)
 * @param {string} id auto-incremented id
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
 * TODO allow named groups from app.
 *
 * @param {string} prefix prefix name
 * @param {Object} data app-specific data object
 * @param {string} id app-specific object id
 */
export function setData(prefix, id, data) {
  setDataHelper(getDataKey(prefix, id), data, getLinkedName());
}

/**
 * Function that handles propagating data to all members of the 
 * group and storing the datum locally.
 *
 * @param {string} key data key
 * @param {Object} data data value
 * @param {string} groupID ID of group to propagate to
 *
 * @private
 */
function setDataHelper(key, data, groupID) {
  // check permissions
  let pubkey = getPubkey();
  if (!hasWriterPriv(pubkey, groupID)) {
    printBadDataPermissionsError();
    return;
  }

  let value = {
    groupID: groupID,
    data: data,
  };
  // set data locally
  db.set(key, value);
  let pubkeys = resolveIDs([groupID]).filter((x) => x != pubkey);
  // send to other devices in groupID
  sendMessage(pubkeys, {
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
 * @param {?string} prefix data prefix
 * @param {?string} id app-specific object id
 * @returns {Object|Object[]|null}
 */
export function getData(prefix = null, id = null) {
  if (prefix === null) {
    // get all app data
    let results = [];
    let appPrefixes = storagePrefixes.filter((x) => x != GROUP);
    appPrefixes.forEach((appPrefix) => {
      db.getMany(getDataPrefix(appPrefix)).forEach((dataObj) => {
        results.push({
          key: dataObj.key,
          value: dataObj.value,
        });
      });
    });
    return results;
  }
  if (id === null) {
    // get all data within prefix
    let results = [];
    let topLevelNames = getChildren(CONTACTS).concat([getLinkedName()]);
    let intermediate = db.getMany(getDataPrefix(prefix));
    intermediate.forEach(({ key, value }) => {
      // deduplicates admins/writers/readers lists
      let admins = listIntersect(topLevelNames, getAdmins(value.groupID));
      let writers = listIntersect(topLevelNames, getWriters(value.groupID).filter((x) => !admins.includes(x)));
      let readers = listIntersect(topLevelNames, getChildren(value.groupID).filter((x) => !admins.includes(x) && !writers.includes(x)));
      results.push({
        id: key.split(SLASH)[2],
        data: value.data,
        admins: admins,
        writers: writers,
        readers: readers,
      });
    });
    return results;
  }
  // get single data item
  return db.get(getDataKey(prefix, id))?.data ?? null;
}

/**
 * Helper function for determining the intersection between two lists.
 *
 * @param {string[]} list1
 * @param {string[]} list2
 * @returns {string[]} intersection of list1 and list2
 *
 * @private
 */
function listIntersect(list1, list2) {
  let intersection = [];
  list1.forEach((e) => {
    if (list2.includes(e)) intersection.push(e);
  });
  return intersection;
}

/**
 * Removes the datum with prefix and id.
 *
 * @param {string} prefix data prefix
 * @param {string} id data id (app-specific)
 */
export function removeData(prefix, id) {
  removeDataHelper(getDataKey(prefix, id));
}

/**
 * Function that handles propagating data removal to all members of the 
 * group and deleting the datum locally.
 *
 * @param {string} key data key
 * @param {?string} groupID group ID to use for resolving pubkeys to delete from
 *
 * @private
 */
function removeDataHelper(key, curGroupID = null, toUnshareGroupID = null) {
  if (curGroupID === null) {
    curGroupID = db.get(key)?.groupID;
  }
  if (curGroupID !== null) {
    let pubkey = getPubkey();
    if (!hasWriterPriv(pubkey, curGroupID)) {
      printBadDataPermissionsError();
      return;
    }

    // delete data from select devices only (unsharing)
    if (toUnshareGroupID !== null) {
      let pubkeys = resolveIDs([toUnshareGroupID]).filter((x) => x != pubkey);
      sendMessage(pubkeys, {
        msgType: DELETE_DATA,
        key: key,
      });
      return;
    }

    // delete data from all devices in group including current (removing data)
    db.remove(key);
    let pubkeys = resolveIDs([curGroupID]).filter((x) => x != pubkey);
    sendMessage(pubkeys, {
      msgType: DELETE_DATA,
      key: key,
    });
  }
}

/**
 * Stores data value at data key (where data value has group information).
 *
 * @param {string} key data key
 * @param {Object} value data value
 *
 * @private
 */
function updateData({ key, value }) {
  db.set(key, value);
}

/**
 * Deletes data key (and associated value).
 *
 * @param {string} key data key
 *
 * @private
 */
function deleteData({ key }) {
  db.remove(key);
}

export function shareAsReader(prefix, id, toShareGroupID) {
  shareData(prefix, id, toShareGroupID);
}

export function shareAsWriter(prefix, id, toShareGroupID) {
  let { restNewMemberPubkeys, sharingGroupID } = shareData(prefix, id, toShareGroupID);
  if (sharingGroupID !== null) {
    // add writer
    addWriterHelper(sharingGroupID, toShareGroupID, restNewMemberPubkeys);
  }
}

export function shareAsAdmin(prefix, id, toShareGroupID) {
  let { restNewMemberPubkeys, sharingGroupID } = shareData(prefix, id, toShareGroupID);
  if (sharingGroupID !== null) {
    // add writer
    addWriterHelper(sharingGroupID, toShareGroupID, restNewMemberPubkeys);
    // add admin
    addAdminHelper(sharingGroupID, toShareGroupID, restNewMemberPubkeys);
  }
}

/**
 * Shares data item by creating new group that subsumes both it's 
 * current group and the new group to share with (commonly, a contact's 
 * name). Then propagates the new group info to all members of that 
 * group along with the data item itself.
 *
 * @param {string} prefix data prefix
 * @param {string} id data id
 * @param {string} toShareGroupID id with which to share data
 */
function shareData(prefix, id, toShareGroupID) {
  if (getGroup(toShareGroupID) === null) {
    return;
  }

  let key = getDataKey(prefix, id);
  let value = db.get(key);
  let curGroupID = value?.groupID ?? null;

  if (curGroupID !== null) {
    // check that current device can modify this group
    let pubkey = getPubkey();
    if (!hasAdminPriv(pubkey, curGroupID)) {
      printBadGroupPermissionsError();
      return;
    }

    let sharingGroupID;
    let linkedName = getLinkedName();
    let restNewMemberPubkeys = resolveIDs([curGroupID, toShareGroupID]).filter((x) => x != pubkey);
    // if underlying group is linkedName, generate new group to encompass sharing
    if (curGroupID === linkedName) {
      sharingGroupID = getNewGroupID();
      // create new sharing group
      createGroup(sharingGroupID, null, [], [curGroupID, toShareGroupID], [curGroupID], [curGroupID]);
      newGroupHelper(sharingGroupID, getGroup(sharingGroupID), restNewMemberPubkeys);
      // add parent pointers for both previously-existing groups
      // note: have to separately add parents everywhere instead of just doing 
      // it once and sending updated group b/c groups on diff devices have diff
      // permissions/etc, don't want to override that
      // open problem: how to only do work once without compromising security
      addParentHelper(curGroupID, sharingGroupID, restNewMemberPubkeys);
      addParentHelper(toShareGroupID, sharingGroupID, restNewMemberPubkeys);
      // send actual data that group now points to
      setDataHelper(key, value.data, sharingGroupID);
    } else { // sharing group already exists for this data object, modify existing group
      sharingGroupID = curGroupID;
      let curGroupValue = getGroup(sharingGroupID);
      let newMemberPubkeys = resolveIDs([toShareGroupID]);
      // send existing sharing group to new member devices
      newGroupHelper(sharingGroupID, curGroupValue, newMemberPubkeys);
      // add child to existing sharing group
      addChildHelper(sharingGroupID, toShareGroupID, restNewMemberPubkeys);
      // add parent from new child to existing sharing group
      addParentHelper(toShareGroupID, sharingGroupID, restNewMemberPubkeys);
      // send actual data that group now points to
      setDataHelper(key, value.data, sharingGroupID);
    }
    return {
      restNewMemberPubkeys: restNewMemberPubkeys,
      sharingGroupID: sharingGroupID,
    };
  }
  // TODO also share missing contact info? or else how to prevent group/data
  // from getting out of sync due to holes in who-knows-who (assuming originating
  // party does not make all modifications to shared object)
  return {
    restNewMemberPubkeys: [],
    sharingGroupID: null,
  };
}

/**
 * Unshares data item by creating new group that excludes groupID (commonly
 * a contact's name or any other subgroup). Propagates the new group info
 * to the new group members and deletes old group and data from groupID's
 * devices.
 *
 * @param {string} prefix data prefix
 * @param {string} id data id
 * @param {string} toUnshareGroupID id with which to unshare data
 */
export function unshareData(prefix, id, toUnshareGroupID) {
  // check that group exists
  if (getGroup(toUnshareGroupID) === null) {
    return;
  }

  // check that data is currently shared with that group
  let key = getDataKey(prefix, id);
  let value = db.get(key);
  let curGroupID = value?.groupID ?? null;
  if (!isMember(toUnshareGroupID, [curGroupID])) {
    return;
  }

  // prevent device from unsharing with self?
  // TODO would we ever want to allow this?
  // maybe makes more sense to check against the admins of the group? although
  // want this to be possible too...
  let linkedName = getLinkedName();
  if (toUnshareGroupID === linkedName) {
    return;
  }

  // unshare data with group
  if (curGroupID !== null) {
    // check that current device can modify group
    if (!hasAdminPriv(getPubkey(), curGroupID)) {
      printBadGroupPermissionsError();
      return;
    }

    // FIXME assuming simple structure, won't work if toUnshareGroupID is
    // further than the first level down
    let newChildren = getChildren(curGroupID).filter((x) => x != toUnshareGroupID);

    let toUnsharePubkeys = resolveIDs([toUnshareGroupID]);
    // delete data from toUnshareGroupID devices
    // do this first because need old group info to check that this device
    // can indeed unshare
    removeDataHelper(key, curGroupID, toUnshareGroupID);
    // unlink and delete curGroupID group on toUnshareGroupID devices
    sendMessage(toUnsharePubkeys, {
      msgType: REMOVE_PARENT,
      groupID: toUnshareGroupID,
      parentID: curGroupID,
    });
    sendMessage(toUnsharePubkeys, {
      msgType: DELETE_GROUP,
      groupID: curGroupID,
    });

    // use newChildren[0] (existing group) as the new group name
    // (e.g. when an object is shared with one contact and then unshared with 
    // that same contact, newChildren[0] is expected to be the linkedName of the
    // sharing device(s))
    if (newChildren.length === 1) {
      let sharingPubkeys = resolveIDs([newChildren[0]]);
      // unlink and delete curGroupID group on newChildren[0] devices
      sendMessage(sharingPubkeys, {
        msgType: REMOVE_PARENT,
        groupID: newChildren[0],
        parentID: curGroupID,
      });
      sendMessage(sharingPubkeys, {
        msgType: DELETE_GROUP,
        groupID: curGroupID,
      });
      // update data with new group ID on newChildren[0] devices
      setDataHelper(key, value.data, newChildren[0]);
    } else {
      let sharingGroupID = getNewGroupID();
      let oldGroup = getGroup(curGroupID);
      // create new group using curGroupID's admins and writers list (removing
      // any instances of toUnshareGroupID _on the immediate next level_
      // TODO check as far down as possible
      createGroup(sharingGroupID, null, [], newChildren, oldGroup.admins.filter((x) => x != toUnshareGroupID), oldGroup.writers.filter((x) => x != toUnshareGroupID));

      let sharingPubkeys = resolveIDs([sharingGroupID]);
      // send new group
      newGroupHelper(sharingGroupID, getGroup(sharingGroupID), sharingPubkeys);
      // relink parent pointers to new group for all remaining children of new group
      newChildren.forEach((newChild) => {
        sendMessage(sharingPubkeys, {
          msgType: REMOVE_PARENT,
          groupID: newChild,
          parentID: curGroupID,
        });
        sendMessage(sharingPubkeys, {
          msgType: ADD_PARENT,
          groupID: newChild,
          parentID: sharingGroupID,
        });
      });
      // delete old group
      sendMessage(sharingPubkeys, {
        msgType: DELETE_GROUP,
        groupID: curGroupID,
      });
      // update data with new group ID on sharingGroupID devices
      setDataHelper(key, value.data, sharingGroupID);

      // OK to just remove toUnshareGroupID from group b/c unique group per
      // object => don't need to worry about breaking the sharing of other 
      // objects TODO unless eventually (for space efficiency) use one group
      // for multiple objects
    }
  }
}

/*
 ***************
 * Permissions *
 ***************
 */

/**
 * Checks that sender has proper permissions according to group and resolves
 * the dumultiplexing function.
 *
 * @param {Object} payload decrypted message contents
 * @param {string} srcPubkey sender public key
 * @returns {{ permissionsOK: boolean,
 *             demuxFunc: callback }}
 *
 * @private
 */
function checkPermissions(payload, srcPubkey) {
  let permissionsOK = false;

  // no reader checks, any device that gets data should correctly be a reader
  switch(payload.msgType) {
    /* special checks */
    case CONFIRM_UPDATE_LINKED: {
      if (getOutstandingLinkPubkey() === srcPubkey) {
        permissionsOK = true;
      }
      break;
    /* admin checks */
    } case LINK_GROUPS: {
      if (hasAdminPriv(srcPubkey, payload.parentID) && hasAdminPriv(srcPubkey, payload.childID)) {
        permissionsOK = true;
      }
      break;
    } case DELETE_SELF: {
      if (hasAdminPriv(srcPubkey, getPubkey())) {
        permissionsOK = true;
      }
      break;
    } case NEW_GROUP: {
      if (hasAdminPriv(srcPubkey, payload.value.parents, false)) {
        permissionsOK = true;
      }
      if (hasAdminPriv(srcPubkey, payload.value.admins, false)) {
        permissionsOK = true;
      }
      break;
    } case UPDATE_GROUP: {
      if (hasAdminPriv(srcPubkey, payload.groupID)) {
        permissionsOK = true;
      }
      break;
    } case ADD_PARENT: {
      // ok to add parent (e.g. send this group data)
      // not ok to add child (e.g. have this group send data to me)
      if (hasAdminPriv(srcPubkey, payload.parentID)) {
        permissionsOK = true;
      }
      break;
    } case ADD_CHILD: {
      if (hasAdminPriv(srcPubkey, payload.groupID)) {
        permissionsOK = true;
      }
      break;
    } case ADD_WRITER: {
      if (hasAdminPriv(srcPubkey, payload.groupID)) {
        permissionsOK = true;
      }
      break;
    } case ADD_ADMIN: {
      if (hasAdminPriv(srcPubkey, payload.groupID)) {
        permissionsOK = true;
      }
      break;
    } case REMOVE_PARENT: {
      if (hasAdminPriv(srcPubkey, payload.parentID)) {
        permissionsOK = true;
      }
      break;
    } case DELETE_GROUP: {
      if (hasAdminPriv(srcPubkey, payload.groupID) || getOutstandingLinkPubkey() === srcPubkey) {
        permissionsOK = true;
      }
      break;
    /* writer checks */
    } case UPDATE_DATA: {
      if (hasWriterPriv(srcPubkey, payload.value.groupID)) {
        permissionsOK = true;
      }
      break;
    } case DELETE_DATA: {
      if (hasWriterPriv(srcPubkey, db.get(payload.key)?.groupID)) {
        permissionsOK = true;
      }
      break;
    }
    case REQ_UPDATE_LINKED:
    case REQ_CONTACT:
    case CONFIRM_CONTACT:
      permissionsOK = true;
      break;
    default:
  }

  return {
    permissionsOK: permissionsOK,
    demuxFunc: demuxMap[payload.msgType],
  };
}

/**
 * Check if one groupID has admin privileges for another groupID.
 * 
 * @param {string} toCheckID id to check if has permissions
 * @param {string} groupID id to use for checking permissions
 * @param {boolean} inDB boolean used to encode the need for an in-memory 
 *   admin-privilege-checking function, rather than one that queries storage
 * @returns {boolean}
 *
 * @private
 */
function hasAdminPriv(toCheckID, groupID, inDB = true) {
  if (!inDB) {
    return isMember(toCheckID, getAdminsMem(groupID));
  }
  return isMember(toCheckID, getAdmins(groupID));
}

/**
 * Check if one groupID has writer privileges for another groupID.
 *
 * @param {string} toCheckID is to check if has permissions
 * @param {string} groupID id to use for checking permissions
 * @returns {boolean}
 *
 * @private
 */
function hasWriterPriv(toCheckID, groupID) {
  return isMember(toCheckID, getWriters(groupID));
}

/**
 * Checks if a groupID is a member of a group.
 *
 * @param {string[]} groupIDList list of group IDs to check all children of
 * @param {string} toCheckGroupID ID of group to check for
 * @returns {boolean}
 *
 * @private
 */
function isMember(toCheckGroupID, groupIDList) {
  let isMemberRetval = false;
  groupIDList.forEach((groupID) => {
    if (groupID === toCheckGroupID) {
      isMemberRetval |= true;
      return;
    }
    isMemberRetval |= isMember(toCheckGroupID, getChildren(groupID));
  });
  return isMemberRetval;
}

/*
 *******************
 * Data Invariants *
 *******************
 */

/**
 * Sets the callback function with which to perform message validation
 * for this application.
 *
 * TODO validate newValidateCallback to ensure it only takes one arg (payload)
 * and returns boolean.
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
  return validateCallback(payload);
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
