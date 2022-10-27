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

import * as sc from "./serverComm/socketIOWrapper.js";
import * as c from  "./crypto/olmWrapper.js";
import * as db from "./db/localStorageWrapper.js";

export { db };
// FIXME export sc for crypto only - how to export for just this module?
// TODO try just importing sc from crypto file
/* Export for crypto */
export const getOtkey = sc.getOtkey;
export const addDevice = sc.addDevice;

/* Export for serverComm */
export const setOtkey = c.setOtkey;
export const generateMoreOtkeys = c.generateMoreOtkeys;

/* Export for Apps */
export const getIdkey = c.getIdkey;
export const idkeyPrefix = c.IDKEY;

/* Local variables */

const SLASH = "/";
const DATA  = "__data";
const GROUP = "__group";
const LINKED   = "__linked";
const CONTACTS = "__contacts";

const OUTSTANDING_IDKEY = "__outstandingIdkey";

// FIXME need new special name for LINKED group (confusing when linking non-LINKED groups)

// valid message types
const REQ_UPDATE_LINKED     = "requestUpdateLinked";
const CONFIRM_UPDATE_LINKED = "confirmUpdateLinked";
const LINK_GROUPS           = "linkGroups";
const ADD_PARENT            = "addParent";
const REMOVE_PARENT         = "removeParent";
const ADD_CHILD             = "addChild";
const ADD_WRITER            = "addWriter";
const REMOVE_WRITER         = "removeWriter";
const ADD_ADMIN             = "addAdmin";
const REMOVE_ADMIN          = "removeAdmin";
const NEW_GROUP             = "newGroup";
const UPDATE_GROUP          = "updateGroup"; // only used within LINKED group
const DELETE_DEVICE         = "deleteDevice";
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
  [REMOVE_WRITER]:         removeWriter,
  [ADD_ADMIN]:             addAdmin,
  [REMOVE_ADMIN]:          removeAdmin,
  [NEW_GROUP]:             updateGroup,
  [UPDATE_GROUP]:          updateGroup,
  [DELETE_DEVICE]:         deleteDevice,
  [DELETE_GROUP]:          deleteGroup,
  [REQ_CONTACT]:           processRequestContact,
  [CONFIRM_CONTACT]:       confirmContact,
  [UPDATE_DATA]:           updateData,
  [DELETE_DATA]:           deleteData,
};

// default auth/unauth functions do nothing
let defaultOnAuth   = () => {};
let defaultOnUnauth = () => {};

// default callback
let defaultValidateCallback = (payload) => {
  console.log("validating payload... " + db.toString(payload));
  return true;
}

// init options
let storagePrefixes = [GROUP];
let onAuth;
let onUnauth;
let validateCallback;
let turnEncryptionOff;

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
const NAME          = "name";
const PARENTS       = "parents";
const CHILDREN      = "children";
const ADMINS        = "admins";
const WRITERS       = "writers";
const CONTACT_LEVEL = "contactLevel";

const keyString = [NAME, CONTACT_LEVEL, PARENTS, ADMINS, WRITERS].join(" ");
const Key   = makeGroup(keyString);
// readers list isn't necessary, any member that isn't an admin
// or writer can be assumed to be a reader
// TODO also deduplicate admins and writers (any writer who is also an
// admin can _just_ exist in the admin group, since admin abilities are a
// superset of writer abilities
const groupString = [NAME, CONTACT_LEVEL, PARENTS, CHILDREN, ADMINS, WRITERS].join(" ");
const Group = makeGroup(groupString);

/* DB listener plugin */

function createDBListenerPlugin() {
  return () => {
    window.addEventListener("storage", (e) => {
      if (e.key === null) {
        onUnauth();
      } else if (e.key.includes(c.IDKEY)) {
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
export async function init(ip, port, config) {
  await c.init();
  sc.init(ip, port);
  onAuth = config.onAuth ?? defaultOnAuth;
  onUnauth = config.onUnauth ?? defaultOnUnauth;
  validateCallback = config.validateCallback ?? defaultValidateCallback;
  turnEncryptionOff = config.turnEncryptionOff ?? false;
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
 * @param {?string} idkey public key of current device
 */
export function connectDevice(idkey = null) {
  if (idkey !== null) {
    sc.connect(idkey);
  } else {
    sc.connect(getIdkey());
  }
}

/**
 * Simulates offline devices
 */
export function disconnectDevice() {
  sc.disconnect(getIdkey());
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
 * @param {string[]} dstIdkeys public keys to send message to
 * @param {Object} payload message contents
 *
 * @private
 */
async function sendMessage(dstIdkeys, payload) {
  let batch = new Array();
  let srcIdkey = getIdkey();

  for (let dstIdkey of dstIdkeys) {
    let encPayload = await c.encrypt(
      db.toString(payload),
      dstIdkey,
      turnEncryptionOff
    );
    batch.push({
      dstIdkey: dstIdkey,
      encPayload: encPayload,
    });
  }

  // send message to server
  sc.sendMessage({
    srcIdkey: srcIdkey,
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
 *           srcIdkey: string }} msg message with encrypted contents
 */
export function onMessage(msg) {
  console.log("seqID: " + msg.seqID);
  console.log(msg);
  let payload = db.fromString(c.decrypt(
      msg.encPayload,
      msg.srcIdkey,
      turnEncryptionOff
  ));

  let { permissionsOK, demuxFunc } = checkPermissions(payload, msg.srcIdkey);
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
  // FIXME need to await? (updateGroup is async) but also nothing to wait for...
  demuxFunc(payload);
}

/**
 * Resolves a list of one or more group IDs to a list of public keys.
 *
 * @param {string[]} ids group IDs to resolve
 * @return {string[]}
 *
 * @private
 */
function resolveIDs(ids, exclude) {
  let idkeys = [];
  ids.forEach((id) => {
    let group = getGroup(id);
    if (group !== null) {
      if (isKey(group)) {
        idkeys.push(id);
      } else {
        idkeys = idkeys.concat(resolveIDs(group.children));
      }
    }
  });
  return idkeys.filter((x) => x !== exclude);
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
async function initDevice(linkedName = null, deviceName = null) {
  let idkey = await c.generateKeys();

  // enforce that linkedName exists; deviceName is not necessary
  if (linkedName === null) {
    linkedName = crypto.randomUUID();
  }
  createGroup(LINKED, linkedName, false, [], [linkedName], [linkedName], [linkedName]);
  createGroup(linkedName, null, false, [LINKED], [idkey], [linkedName], [linkedName]);
  createKey(idkey, deviceName, false, [linkedName], [linkedName], [linkedName]);

  createGroup(CONTACTS, null, false, [], [], [linkedName], [linkedName]);

  return {
    idkey: idkey,
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
export async function createDevice(linkedName = null, deviceName = null) {
  let { idkey } = await initDevice(linkedName, deviceName);
  console.log(idkey);
  onAuth();
  return idkey;
}

/**
 * Initializes device and requests to link with existing device.
 *
 * @param {string} dstIdkey hex-formatted public key of device to link with
 * @param {?string} deviceName human-readable name (for self)
 * @returns {string}
 */
export async function createLinkedDevice(dstIdkey, deviceName = null) {
  if (dstIdkey !== null) {
    let { idkey, linkedName } = await initDevice(null, deviceName);
    console.log(idkey);
    let linkedMembers = getAllSubgroups([linkedName]);
    // construct message that asks dstIdkey's device to link this device
    setOutstandingLinkIdkey(dstIdkey);
    await sendMessage([dstIdkey], {
      msgType: REQ_UPDATE_LINKED,
      tempName: linkedName,
      srcIdkey: idkey,
      newLinkedMembers: linkedMembers,
    });
    return idkey;
  }
}

/**
 * Helper that sets temporary state to help with permission checks when
 * the current device has requested to be linked with another.
 *
 * @param {string} idkey idkey to link with and from which additional/updated
 *   group information will come (and which this device should thus allow)
 *
 * @private
 */
function setOutstandingLinkIdkey(idkey) {
  db.set(OUTSTANDING_IDKEY, idkey);
}

/**
 * Helper for retrieving temporary state to help with permission checks when
 * the current device has requested to be linked with another.
 *
 * @returns {string} the idkey with which this device has requested to link
 *
 * @private
 */
function getOutstandingLinkIdkey() {
  return db.get(OUTSTANDING_IDKEY);
}

/**
 * Clears temporary state.
 *
 * @private
 */
function removeOutstandingLinkIdkey() {
  db.remove(OUTSTANDING_IDKEY);
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
 * @param {string} tempName temporary name of device requesting to link
 * @param {string} srcIdkey idkey of device requesting to link
 * @param {Object[]} newLinkedMembers linked subgroups of device requesting to link
 *
 * @private
 */
async function processUpdateLinkedRequest({ tempName, srcIdkey, newLinkedMembers }) {
  if (confirm(`Authenticate new LINKED group member?\n\tName: ${tempName}`)) {
    // get rest of linked idkeys to update
    let idkey = getIdkey();
    let restLinkedIdkeys = resolveIDs([LINKED], idkey);
    let linkedName = getLinkedName();

    /* UPDATE OLD SELF */

    // replace all occurrences of tempName with linkedName
    let updatedNewLinkedMembers = [];
    newLinkedMembers.forEach((newGroup) => {
      updatedNewLinkedMembers.push(groupReplace(newGroup, tempName, linkedName));
    });

    for (let newGroup of updatedNewLinkedMembers) {
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
        await sendMessage(restLinkedIdkeys, {
          msgType: UPDATE_GROUP,
          groupID: linkedName,
          value: getGroup(linkedName),
        });
      } else {
        await updateGroup({ groupID: newGroup.id, value: newGroup.value });
        await newGroupHelper(newGroup.id, newGroup.value, restLinkedIdkeys);
      }
    }

    /* UPDATE NEW SELF */

    // delete old linkedName group
    await sendMessage([srcIdkey], {
      msgType: DELETE_GROUP,
      groupID: tempName,
    });
    // notify new group member of successful link and piggyback existing 
    // group info and data
    await sendMessage([srcIdkey], {
      msgType: CONFIRM_UPDATE_LINKED,
      existingGroups: getAllGroups(),
      existingData: getData(),
    });

    /* UPDATE OTHER */

    // notify contacts
    let contactIdkeys = resolveIDs([CONTACTS]);
    let contactNames = getChildren(CONTACTS);
    for (let newGroup of updatedNewLinkedMembers) {
      if (newGroup.id === linkedName) {
        for (const child of newGroup.value.children) {
          await sendMessage(contactIdkeys, {
            msgType: ADD_CHILD,
            groupID: linkedName,
            childID: child,
          });
        }
      } else {
        for (const contactName of contactNames) {
          await newGroupHelper(newGroup.id, addAdmin({ groupID: newGroup.id, adminID: contactName }), resolveIDs([contactName]));
        }
      }
    }
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
 * Helper function that checks if the specified ID is in the specified 
 * group field's list.
 *
 * @param {string} key name of group field to check
 * @param {Object} fullGroup actual group to check 
 * @param {string} IDToCheck id to check for
 *
 * @private
 */
function groupContainsHelper(key, fullGroup, IDToCheck) {
  if (fullGroup.value[key]?.includes(IDToCheck)) {
    return true;
  }
  return false;
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
  groupReplaceHelper(PARENTS, updatedGroup, IDToReplace, replacementID);
  groupReplaceHelper(CHILDREN, updatedGroup, IDToReplace, replacementID);
  groupReplaceHelper(ADMINS, updatedGroup, IDToReplace, replacementID);
  groupReplaceHelper(WRITERS, updatedGroup, IDToReplace, replacementID);
  return updatedGroup;
}

/**
 * Checks if specified ID is in any of a group's fields.
 *
 * @param {Object} group group to modify
 * @param {string} IDToCheck id to check for
 * @returns {boolean}
 *
 * @private
 */
function groupContains(group, IDToCheck) {
  if (group.id === IDToCheck) {
    return true;
  }
  let bool = false;
  bool |= groupContainsHelper(PARENTS, group, IDToCheck);
  bool |= groupContainsHelper(CHILDREN, group, IDToCheck);
  bool |= groupContainsHelper(ADMINS, group, IDToCheck);
  bool |= groupContainsHelper(WRITERS, group, IDToCheck);
  return bool;
}

/**
 * Updates linked group info and and group info for all devices that are 
 * children of the linked group.
 *
 * @param {Object[]} existingGroups existing groups on linked device
 * @param {Object[]} existingData existing data on linked device
 *
 * @private
 */
function confirmUpdateLinked({ existingGroups, existingData }) {
  existingGroups.forEach(({ key, value }) => {
    db.set(key, value);
  });
  existingData.forEach(({ key, value }) => {
    db.set(key, value);
  });
  removeOutstandingLinkIdkey();
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
async function updateGroup({ groupID, value }) {
  // cases that handle shared data where a subset of the members
  // do not already exist in this device's contacts list
  let contacts = getContacts();
  // if contactLevel = true but not in contacts, add
  if (value.contactLevel && !contacts.includes(groupID)) {
    await addChildHelper(CONTACTS, groupID, resolveIDs([LINKED], getIdkey()));
  }
  // if in contacts but contactLevel = false, make contactLevel = true
  if (!value.contactLevel && contacts.includes(groupID)) {
    value.contactLevel = true;
  }
  setGroup(groupID, value);
}

/**
 * Sends NEW_GROUP message to specified idkeys.
 *
 * @param {string} groupID id of group to add
 * @param {Object} value group value to add
 * @param {string[]} idkeys list of idkeys to add group on
 *
 * @private
 */
async function newGroupHelper(groupID, value, idkeys) {
  await sendMessage(idkeys, {
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
 * Shares own contact info and requests the contact info of contactIdkey.
 * TODO implement private contact discovery and return contact name.
 *
 * @param {string} contactIdkey hex-formatted public key
 */
export async function addContact(contactIdkey) {
  // only add contact if not self
  let linkedName = getLinkedName();
  if (!isMember(contactIdkey, [linkedName])) {
    // piggyback own contact info when requesting others contact info
    await sendMessage([contactIdkey], {
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
async function processRequestContact({ reqContactName, reqContactGroups }) {
  if (confirm(`Add new contact: ${reqContactName}?`)) {
    await parseContactInfo(reqContactName, reqContactGroups);
    let linkedName = getLinkedName();
    await sendMessage(resolveIDs([reqContactName]), {
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
async function confirmContact({ contactName, contactGroups }) {
  await parseContactInfo(contactName, contactGroups);
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
async function parseContactInfo(contactName, contactGroups) {
  let idkey = getIdkey();
  let linkedName = getLinkedName();
  let restLinkedIdkeys = resolveIDs([LINKED], idkey);

  // check if "linked" backpointer will be replaced with "contact" backpointer
  let contactLevelIDs = [];
  for (let contactGroup of contactGroups) {
    let deepCopy = JSON.parse(JSON.stringify(contactGroup));
    if (groupContains(deepCopy, LINKED)) {
      contactLevelIDs.push(deepCopy.id);
    }
  }

  for (let contactGroup of contactGroups) {
    let updatedContactGroup = groupReplace(contactGroup, LINKED, CONTACTS);
    // "linked" backpointer was replaced with "contact" backpointer
    // set contactLevel field = true
    if (contactLevelIDs.includes(updatedContactGroup.id)) {
      updatedContactGroup.value.contactLevel = true;
    }
    // create group and add admin for enabling future deletion of this contact + groups
    addAdminInMem(updatedContactGroup.value, linkedName);
    await updateGroup({
      groupID: updatedContactGroup.id,
      value: updatedContactGroup.value,
    });
    await newGroupHelper(updatedContactGroup.id, updatedContactGroup.value, restLinkedIdkeys);
  }

  linkGroups({
    parentID: CONTACTS,
    childID: contactName,
  });
  await sendMessage(restLinkedIdkeys, {
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
export async function removeContact(name) {
  // remotely
  await sendMessage(resolveIDs([LINKED], getIdkey()), {
    msgType: DELETE_GROUP,
    groupID: name,
  });
  // locally
  deleteGroup({ groupID: name });
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
export async function deleteDevice() {
  // notify all direct parents and contacts that this group should be removed
  let idkey = getIdkey();
  await sendMessage(resolveIDs(getParents(idkey).concat([CONTACTS]), idkey), {
    msgType: DELETE_GROUP,
    groupID: idkey,
  });
  deleteSelf(idkey);
}

/**
 * Helper function for deleting the current device.
 *
 * @param {string} idkey current device's identity key
 */
function deleteSelf(idkey) {
  sc.removeDevice(idkey);
  sc.disconnect(idkey);
  db.clear();
  onUnauth();
}

/**
 * Deletes the device pointed to by idkey.
 *
 * @param {string} idkey hex-formatted public key
 */
export async function deleteLinkedDevice(idkey) {
  await sendMessage([idkey], {
    msgType: DELETE_DEVICE,
    groupID: getLinkedName(),
  });
}

/**
 * Deletes all devices that are children of this device's linked group.
 */
export async function deleteAllLinkedDevices() {
  let idkey = getIdkey();
  // remotely
  await sendMessage(resolveIDs([LINKED], idkey), {
    msgType: DELETE_DEVICE,
    groupID: getLinkedName(),
  });
  // locally
  deleteSelf(idkey);
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
  // TODO if group is a device, delete session associated with it
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
function createGroup(ID, name, contactLevel, parents, children, admins, writers) {
  setGroup(ID, new Group(name, contactLevel, parents, children, admins, writers));
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
function createKey(ID, name, contactLevel, parents, admins, writers) {
  setGroup(ID, new Key(name, contactLevel, parents, admins, writers));
}

const listRemoveCallback = (ID, newList) => {
  let idx = newList.indexOf(ID);
  if (idx !== -1) newList.splice(idx, 1);
  return newList;
};

const listAddCallback = (ID, newList) => {
  // deduplicate: only add ID if doesn't already exist in list
  if (newList.indexOf(ID) === -1) newList.push(ID);
  return newList;
};

/**
 * Helper function for updating the specified list of an existing group.
 *
 * @param {string} key list key
 * @param {string} groupID ID of group to modify
 * @param {string} memberID ID of list member to add/remove
 * @param {callback} callback operation to perform on the list
 * @returns {Object}
 *
 * @private
 */
function updateList(key, groupID, memberID, callback) {
  let oldGroupValue = getGroup(groupID);
  let newList = callback(memberID, oldGroupValue[key]);
  let newGroupValue = { ...oldGroupValue, [key]: newList };
  setGroup(groupID, newGroupValue);
  return newGroupValue;
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
 * Recursively gets all children groups in the subtree with root groupID (result includes the root group).
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
 * Adds an additional child (ID or idkey) to an existing group's children list.
 *
 * @param {string} groupID ID of group to modify
 * @param {string} childID ID of child to add
 * @returns {Object}
 *
 * @private
 */
function addChild({ groupID, childID }) {
  return updateList(CHILDREN, groupID, childID, listAddCallback);
}

/**
 * Adds child locally and remotely on all devices in group (specified by idkeys
 * parameter).
 *
 * @param {string} groupID ID of group to modify
 * @param {string} childID ID of child to add
 * @param {string[]} idkeys devices to remotely make this modification on
 *
 * @private
 */
async function addChildHelper(groupID, childID, idkeys) {
  // remotely
  await sendMessage(idkeys, {
    msgType: ADD_CHILD,
    groupID: groupID,
    childID: childID,
  });
  // locally
  addChild({ groupID: groupID, childID: childID });
}

/**
 * Removes a child (ID or idkey) from an existing group's children list.
 * Noop if child did not exist in the children list.
 *
 * @param {string} groupID ID of group to modify
 * @param {string} childID ID of child to remove
 * @returns {Object}
 *
 * @private
 */
function removeChild(groupID, childID) {
  return updateList(CHILDREN, groupID, childID, listRemoveCallback);
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
  return updateList(PARENTS, groupID, parentID, listAddCallback);
}

/**
 * Adds parent locally and remotely on all devices in group (specified by idkeys
 * parameter).
 *
 * @param {string} groupID ID of group to modify
 * @param {string} parentID ID of parent to add
 * @param {string[]} idkeys devices to remotely make this modification on
 *
 * @private
 */
async function addParentHelper(groupID, parentID, idkeys) {
  // remotely
  await sendMessage(idkeys, {
    msgType: ADD_PARENT,
    groupID: groupID,
    parentID: parentID,
  });
  // locally
  addParent({ groupID: groupID, parentID: parentID });
}

/**
 * Removes a parent (ID or idkey) from an existing group's parents list.
 * Noop if parent did not exist in the parent list.
 *
 * @param {string} groupID ID of group to modify
 * @param {string} parentID ID of parent to remove
 * @returns {Object}
 *
 * @private
 */
function removeParent({ groupID, parentID }) {
  return updateList(PARENTS, groupID, parentID, listRemoveCallback);
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
function getAdminsIntersection(groupIDs) {
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
 * Adds admin to admins list of a group (modifies group in place). Necessary
 * for some functionality to do this in-place, e.g. when adding contacts the
 * current device adds itself as an admin and needs to propagate that to all
 * the other linked devices (which would fail the permissions check if it was
 * sent as a separate message).
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

/**
 * Adds an additional admin (ID) to an existing group's admins list.
 *
 * @param {string} groupID ID of group to modify
 * @param {string} adminID ID of admin to add
 * @returns {Object}
 *
 * @private
 */
function addAdmin({ groupID, adminID }) {
  return updateList(ADMINS, groupID, adminID, listAddCallback);
}

/**
 * Adds admin locally and remotely on all devices in group (specified by idkeys
 * parameter).
 *
 * @param {string} groupID ID of group to modify
 * @param {string} adminID ID of admin to add
 * @param {string[]} idkeys devices to remotely make this modification on
 *
 * @private
 */
async function addAdminHelper(groupID, adminID, idkeys) {
  // remotely
  await sendMessage(idkeys, {
    msgType: ADD_ADMIN,
    groupID: groupID,
    adminID: adminID,
  });
  // locally
  addAdmin({ groupID: groupID, adminID: adminID });
}

/**
 * Removes an admin (ID or idkey) from an existing group's admins list.
 * Noop if admin did not exist in the admins list.
 *
 * @param {string} groupID ID of group to modify
 * @param {string} adminID ID of admin to remove
 * @returns {Object}
 *
 * @private
 */
function removeAdmin({ groupID, adminID }) {
  return updateList(ADMINS, groupID, adminID, listRemoveCallback);
}

/**
 * Removes admin locally and remotely on all devices in group (specified by idkeys
 * parameter).
 *
 * @param {string} groupID ID of group to modify
 * @param {string} adminID ID of admin to remove
 * @param {string[]} idkeys devices to remotely make this modification on
 *
 * @private
 */
async function removeAdminHelper(prefix, id, toUnshareGroupID) {
  let { curGroupID } = unshareChecks(prefix, id, toUnshareGroupID);
  // remotely
  await sendMessage(resolveIDs([curGroupID]), {
    msgType: REMOVE_ADMIN,
    groupID: curGroupID,
    adminID: toUnshareGroupID,
  });
  // locally
  removeAdmin({ groupID: curGroupID, writerID: toUnshareGroupID });
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
  return updateList(WRITERS, groupID, writerID, listAddCallback);
}

/**
 * Adds writer locally and remotely on all devices in group (specified by idkeys
 * parameter).
 *
 * @param {string} groupID ID of group to modify
 * @param {string} writerID ID of writer to add
 * @param {string[]} idkeys devices to remotely make this modification on
 *
 * @private
 */
async function addWriterHelper(groupID, writerID, idkeys) {
  // remotely
  await sendMessage(idkeys, {
    msgType: ADD_WRITER,
    groupID: groupID,
    writerID: writerID,
  });
  // locally
  addWriter({ groupID: groupID, writerID: writerID });
}

/**
 * Removes a writer (ID or idkey) from an existing group's writers list.
 * Noop if writer did not exist in the writers list.
 *
 * @param {string} groupID ID of group to modify
 * @param {string} writerID ID of writer to remove
 * @returns {Object}
 *
 * @private
 */
function removeWriter({ groupID, writerID }) {
  return updateList(WRITERS, groupID, writerID, listRemoveCallback);
}

/**
 * Removes writer locally and remotely on all devices in group (specified by idkeys
 * parameter).
 *
 * @param {string} groupID ID of group to modify
 * @param {string} writerID ID of writer to remove
 * @param {string[]} idkeys devices to remotely make this modification on
 *
 * @private
 */
async function removeWriterHelper(prefix, id, toUnshareGroupID) {
  let { curGroupID } = unshareChecks(prefix, id, toUnshareGroupID);
  // remotely
  await sendMessage(resolveIDs([curGroupID]), {
    msgType: REMOVE_WRITER,
    groupID: curGroupID,
    writerID: toUnshareGroupID,
  });
  // locally
  removeWriter({ groupID: curGroupID, writerID: toUnshareGroupID });
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

/**
 * Gets all groups on current device.
 *
 * @returns {Object[]}
 *
 * @private
 */
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

/**
 * Removes the parent back-pointer to the group-to-delete and then deletes
 * the group, both locally and remotely.
 *
 * @param {string} groupID id of group whose parent pointer point to the group-to-delete
 * @param {string} parentID id of group-to-delete
 * @param {string[]} idkeys list of idkeys to make remote modification on
 * @param {boolean} local flag for making modification locally
 *
 * @private
 */
async function unlinkAndDeleteGroupHelper(groupID, parentID, idkeys, local = true) {
  // remotely
  await sendMessage(idkeys, {
    msgType: REMOVE_PARENT,
    groupID: groupID,
    parentID: parentID,
  });
  await sendMessage(idkeys, {
    msgType: DELETE_GROUP,
    groupID: parentID,
  });
  // locally
  if (local) {
    removeParent({ groupID: groupID, parentID: parentID });
    deleteGroup({ groupID: parentID });
  }
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
export async function setData(prefix, id, data) {
  await setDataHelper(getDataKey(prefix, id), data, getLinkedName());
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
async function setDataHelper(key, data, groupID) {
  // check permissions
  let idkey = getIdkey();
  if (!hasWriterPriv(idkey, groupID)) {
    printBadDataPermissionsError();
    return;
  }

  let value = {
    groupID: groupID,
    data: data,
  };
  // set data locally
  db.set(key, value);
  let idkeys = resolveIDs([groupID], idkey);
  // send to other devices in groupID
  await sendMessage(idkeys, {
    msgType: UPDATE_DATA,
    key: key,
    value: value,
  });
}

/**
 * If only prefix is specified, gets a list of data objects whose keys begin
 * with that prefix, otherwise get a single data object. Allows getting data
 * for either a single prefix at a time or _all_ app prefixes.
 * TODO allow specifying a sublist of app prefixes?
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
export async function removeData(prefix, id) {
  await removeDataHelper(getDataKey(prefix, id));
}

/**
 * Function that handles propagating data removal to all members of the 
 * group and deleting the datum locally.
 *
 * @param {string} key data key
 * @param {?string} groupID group ID to use for resolving idkeys to delete from
 *
 * @private
 */
async function removeDataHelper(key, curGroupID = null, toUnshareGroupID = null) {
  if (curGroupID === null) {
    curGroupID = db.get(key)?.groupID;
  }
  if (curGroupID !== null) {
    let idkey = getIdkey();
    if (!hasWriterPriv(idkey, curGroupID)) {
      printBadDataPermissionsError();
      return;
    }

    // delete data from select devices only (unsharing)
    if (toUnshareGroupID !== null) {
      let idkeys = resolveIDs([toUnshareGroupID], idkey);
      await sendMessage(idkeys, {
        msgType: DELETE_DATA,
        key: key,
      });
      return;
    }

    // delete data from all devices in group including current (removing data)
    db.remove(key);
    let idkeys = resolveIDs([curGroupID], idkey);
    await sendMessage(idkeys, {
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

/**
 * Allow application to share particular data object with another set of devices
 * with read privileges.
 *
 * @param {string} prefix app prefix for this data object
 * @param {string} id data object id
 * @param {string} toShareGroupID group to grant read privileges to
 */
export async function grantReaderPrivs(prefix, id, toShareGroupID) {
  await shareData(prefix, id, toShareGroupID);
}

/**
 * Allow application to share particular data object with another set of devices
 * with read/write privileges.
 *
 * @param {string} prefix app prefix for this data object
 * @param {string} id data object id
 * @param {string} toShareGroupID group to grant read/write privileges to
 */
export async function grantWriterPrivs(prefix, id, toShareGroupID) {
  let { restNewMemberIdkeys, sharingGroupID, errCode } = await shareData(prefix, id, toShareGroupID);
  if (errCode === 0 && sharingGroupID !== null) {
    // add writer
    await addWriterHelper(sharingGroupID, toShareGroupID, restNewMemberIdkeys);
  }
}

/**
 * Allow application to share particular data object with another set of devices
 * with read/write/admin privileges.
 *
 * @param {string} prefix app prefix for this data object
 * @param {string} id data object id
 * @param {string} toShareGroupID group to grant read/write/admin privileges to
 */
export async function grantAdminPrivs(prefix, id, toShareGroupID) {
  let { restNewMemberIdkeys, sharingGroupID, errCode } = await shareData(prefix, id, toShareGroupID);
  if (errCode === 0 && sharingGroupID !== null) {
    // add writer
    await addWriterHelper(sharingGroupID, toShareGroupID, restNewMemberIdkeys);
    // add admin
    await addAdminHelper(sharingGroupID, toShareGroupID, restNewMemberIdkeys);
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
 *
 * @private
 */
async function shareData(prefix, id, toShareGroupID) {
  let idkey = getIdkey();
  let key = getDataKey(prefix, id);
  let value = db.get(key);
  let curGroupID = value?.groupID ?? null;

  let retval = {
    restNewMemberIdkeys: [],
    sharingGroupID: null,
  };

  // check that current device can modify this group
  if (!hasAdminPriv(idkey, curGroupID)) {
    printBadGroupPermissionsError();
    return { ...retval, errCode: -1 };
  }

  // check that toShareGroupID exists
  if (getGroup(toShareGroupID) === null) {
    return { ...retval, errCode: -1 };
  }

  if (curGroupID !== null) {
    let sharingGroupID;
    let linkedName = getLinkedName();
    let restNewMemberIdkeys = resolveIDs([curGroupID, toShareGroupID], idkey);
    // if underlying group is linkedName, generate new group to encompass sharing
    if (curGroupID === linkedName) {
      sharingGroupID = getNewGroupID();
      // create new sharing group
      createGroup(sharingGroupID, null, false, [], [curGroupID, toShareGroupID], [curGroupID], [curGroupID]);
      await newGroupHelper(sharingGroupID, getGroup(sharingGroupID), restNewMemberIdkeys);
      // add parent pointers for both previously-existing groups
      // note: have to separately add parents everywhere instead of just doing 
      // it once and sending updated group b/c groups on diff devices have diff
      // permissions/etc, don't want to override that
      await addParentHelper(curGroupID, sharingGroupID, restNewMemberIdkeys);
      await addParentHelper(toShareGroupID, sharingGroupID, restNewMemberIdkeys);
      // send actual data that group now points to
      await setDataHelper(key, value.data, sharingGroupID);
    } else { // sharing group already exists for this data object, modify existing group
      sharingGroupID = curGroupID;
      let curGroupValue = getGroup(sharingGroupID);
      let newMemberIdkeys = resolveIDs([toShareGroupID]);

      // send existing sharing group subgroups to new member devices
      let sharingGroupSubgroups = getAllSubgroups([sharingGroupID]);
      for (let sharingGroupSubgroup of sharingGroupSubgroups) {
        let newGroup = groupReplace(sharingGroupSubgroup, LINKED, CONTACTS);
        await newGroupHelper(newGroup.id, newGroup.value, newMemberIdkeys);
      }

      // send new member subgroups to existing members
      await newGroupHelper(sharingGroupID, curGroupValue, newMemberIdkeys);
      let toShareSubgroups = getAllSubgroups([toShareGroupID]);
      let restExistingMemberIdkeys = resolveIDs([curGroupID], idkey);
      for (let toShareSubgroup of toShareSubgroups) {
        let newGroup = groupReplace(toShareSubgroup, LINKED, CONTACTS);
        await newGroupHelper(newGroup.id, newGroup.value, restExistingMemberIdkeys);
      }

      // add child to existing sharing group
      await addChildHelper(sharingGroupID, toShareGroupID, restNewMemberIdkeys);
      // add parent from new child to existing sharing group
      await addParentHelper(toShareGroupID, sharingGroupID, restNewMemberIdkeys);
      // send actual data that group now points to
      await setDataHelper(key, value.data, sharingGroupID);
    }
    return {
      restNewMemberIdkeys: restNewMemberIdkeys,
      sharingGroupID: sharingGroupID,
      errCode: 0,
    };
  }
  return { ...retval, errCode: 0 };
}

/**
 * Remove member from the relevant group's writers list.
 *
 * @param {string} prefix app-specific data prefix
 * @param {string} id data object id
 * @param {string} toUnshareGroupID id of member to revoke write privileges of
 */
export async function revokeWriterPrivs(prefix, id, toUnshareGroupID) {
  await removeWriterHelper(prefix, id, toUnshareGroupID);
}

/**
 * Remove member from the relevant group's admins list.
 *
 * @param {string} prefix app-specific data prefix
 * @param {string} id data object id
 * @param {string} toUnshareGroupID id of member to revoke admin privileges of
 */
export async function revokeAdminPrivs(prefix, id, toUnshareGroupID) {
  await removeAdminHelper(prefix, id, toUnshareGroupID);
}

/**
 * Remove member from all of the relevant group's lists.
 *
 * @param {string} prefix app-specific data prefix
 * @param {string} id data object id
 * @param {string} toUnshareGroupID id of member to revoke privileges of
 */
export async function revokeAllPrivs(prefix, id, toUnshareGroupID) {
  await unshareData(prefix, id, toUnshareGroupID);
}

/**
 * Performs necessary checks before any unsharing/privilege revoking can take place.
 *
 * @param {string} prefix app-specific data prefix
 * @param {string} id data object id
 * @param {string} toUnshareGroupID id of member to revoke privileges of
 *
 * @private
 */
function unshareChecks(prefix, id, toUnshareGroupID) {
  let idkey = getIdkey();
  let key = getDataKey(prefix, id);
  let value = db.get(key);
  let curGroupID = value?.groupID ?? null;

  let retval = {
    idkey: idkey,
    key: key,
    value: value,
    curGroupID: curGroupID,
  };

  // check that current device can modify group
  if (!hasAdminPriv(idkey, curGroupID)) {
    printBadGroupPermissionsError();
    return { ...retval, errCode: -1 };
  }

  // check that group exists
  if (getGroup(toUnshareGroupID) === null) {
    return { ...retval, errCode: -1 };
  }

  // check that data is currently shared with that group
  if (!isMember(toUnshareGroupID, [curGroupID])) {
    return { ...retval, errCode: -1 };
  }

  // prevent device from unsharing with self 
  // TODO when would it make sense to allow this?
  if (isMember(toUnshareGroupID, [getLinkedName()])) {
    return { ...retval, errCode: -1 };
  }

  return { ...retval, errCode: 0 };
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
 *
 * @private
 */
async function unshareData(prefix, id, toUnshareGroupID) {
  let { idkey, key, value, curGroupID, errCode } = unshareChecks(prefix, id, toUnshareGroupID);
  if (errCode === 0 && curGroupID !== null) {
    // delete data from toUnshareGroupID devices before deleting related group
    await removeDataHelper(key, curGroupID, toUnshareGroupID);
    // unlink and delete curGroupID group on toUnshareGroupID devices
    // OK to just remove toUnshareGroupID from group b/c unique group per
    // object => don't need to worry about breaking the sharing of other 
    // objects TODO unless eventually (for space efficiency) use one group
    // for multiple objects
    await unlinkAndDeleteGroupHelper(toUnshareGroupID, curGroupID, resolveIDs([toUnshareGroupID]), false);

    // FIXME assuming simple structure, won't work if toUnshareGroupID is
    // further than the first level down
    let newChildren = getChildren(curGroupID).filter((x) => x != toUnshareGroupID);


    // use newChildren[0] (existing group) as the new group name
    // (e.g. when an object is shared with one contact and then unshared with 
    // that same contact, newChildren[0] is expected to be the linkedName of the
    // sharing device(s))
    if (newChildren.length === 1) {
      let sharingIdkeys = resolveIDs([newChildren[0]], idkey);
      // unlink and delete curGroupID group on new group's devices
      await unlinkAndDeleteGroupHelper(newChildren[0], curGroupID, sharingIdkeys);
      // update data with new group ID on new group's devices
      await setDataHelper(key, value.data, newChildren[0]);
    } else {
      let sharingGroupID = getNewGroupID();
      // create new group using curGroupID's admins and writers list (removing
      // any instances of toUnshareGroupID _on the immediate next level_
      // TODO check as far down as possible

      let oldGroup = getGroup(curGroupID);
      createGroup(
          sharingGroupID,
          null,
          false,
          [],
          newChildren,
          oldGroup.admins.filter((x) => x != toUnshareGroupID),
          oldGroup.writers.filter((x) => x != toUnshareGroupID)
      );
      let sharingIdkeys = resolveIDs([sharingGroupID], idkey);
      await newGroupHelper(sharingGroupID, getGroup(sharingGroupID), sharingIdkeys);

      // delete old group and relink parent points from old group to new group
      // for all remaining children of the new group
      for (let newChild of newChildren) {
        let childIdkeys = resolveIDs([newChild], idkey);
        await unlinkAndDeleteGroupHelper(sharingGroupID, curGroupID, childIdkeys);
        await addParentHelper(newChild, sharingGroupID, childIdkeys);
      }

      // update data with new group ID on sharingGroupID devices
      await setDataHelper(key, value.data, sharingGroupID);
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
 * @param {string} srcIdkey sender public key
 * @returns {{ permissionsOK: boolean,
 *             demuxFunc: callback }}
 *
 * @private
 */
function checkPermissions(payload, srcIdkey) {
  let permissionsOK = false;

  // no reader checks, any device that gets data should correctly be a reader
  switch(payload.msgType) {
    /* special checks */
    case CONFIRM_UPDATE_LINKED: {
      if (getOutstandingLinkIdkey() === srcIdkey) {
        permissionsOK = true;
      }
      break;
    /* admin checks */
    } case LINK_GROUPS: {
      if (hasAdminPriv(srcIdkey, payload.parentID) && hasAdminPriv(srcIdkey, payload.childID)) {
        permissionsOK = true;
      }
      break;
    } case DELETE_DEVICE: {
      if (hasAdminPriv(srcIdkey, getIdkey())) {
        permissionsOK = true;
      }
      break;
    } case NEW_GROUP: {
      // TODO what was this case for again? need to somehow check that
      // can modify all parent groups of a group? but wouldn't that be
      // more like ADD_CHILD?
      if (hasAdminPriv(srcIdkey, payload.value.parents, true)) {
        permissionsOK = true;
      }
      // check that group being created is being created by a device
      // with admin privs
      if (hasAdminPriv(srcIdkey, payload.value.admins, false)) {
        permissionsOK = true;
      }
      break;
    }
    case ADD_PARENT:
    case REMOVE_PARENT: {
      // ok to add parent (e.g. send this group data)
      // not ok to add child (e.g. have this group send data to me)
      if (hasAdminPriv(srcIdkey, payload.parentID)) {
        permissionsOK = true;
      }
      break;
    }
    case UPDATE_GROUP:
    case ADD_CHILD:
    case ADD_WRITER:
    case REMOVE_WRITER:
    case ADD_ADMIN:
    case REMOVE_ADMIN: {
      if (hasAdminPriv(srcIdkey, payload.groupID)) {
        permissionsOK = true;
      }
      break;
    } case DELETE_GROUP: {
      if (getGroup(payload.groupID) === null || hasAdminPriv(srcIdkey, payload.groupID) || getOutstandingLinkIdkey() === srcIdkey) {
        permissionsOK = true;
      }
      break;
    /* writer checks */
    } case UPDATE_DATA: {
      if (hasWriterPriv(srcIdkey, payload.value.groupID)) {
        permissionsOK = true;
      }
      break;
    } case DELETE_DATA: {
      if (hasWriterPriv(srcIdkey, db.get(payload.key)?.groupID)) {
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
 * @param {string} groupID one or more idd to use for checking permissions
 * @param {boolean} inDB boolean used to encode the need for an in-memory 
 *   admin-privilege-checking function, rather than one that queries storage
 * @returns {boolean}
 *
 * @private
 */
function hasAdminPriv(toCheckID, groupIDs, inDB = null) {
  if (inDB === null) { // groupIDs is a single value
    return isMember(toCheckID, getAdmins(groupIDs));
  } else if (inDB) { // inDB == true
    return isMember(toCheckID, getAdminsIntersection(groupIDs));
  } else { // inDB == false
    return isMember(toCheckID, groupIDs);
  }
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
 * @param {string} toCheckGroupID ID of group to check for
 * @param {string[]} groupIDList list of group IDs to check all children of
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
 **************
 * DB Helpers *
 **************
 */

//function setChecked(key, value) {
//  console.log("checking permissions then setting");
//  db.set(key, value);
//}

//function setUnchecked(key, value) {
//  console.log("setting without permission checks");
//  db.set(key, value);
//}

//function getChecked(key) {
//  console.log("checking permissions then getting");
//  db.get(key);
//}
//
//function getUnchecked(key) {
//  console.log("getting without permission checks");
//  db.get(key);
//}
