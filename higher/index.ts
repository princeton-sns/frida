/*
 **************
 **************
 *** Higher ***
 **************
 **************
 */

// TODO thoughts: should permission checks happen at the
// database layer?
// e.g. any local database modifications should either be
// checked (it is possible they come from an external party)
// or unchecked (it is impossible for them to come from an
// external party)
// how hard is reasoning about this?

// TODO add permission checks for setting cryptographic keys?

// TODO instead of using this.#core.olmWrapper.getIdkey() everywhere, idkey is not 
// expected to change so just set some object state once a device is
// created (could still be in olmWrapper)

// TODO need new special name for LINKED group (confusing when linking non-LINKED groups)

import { EventEmitter } from "events";
import { Core } from "../core/client";
import { LocalStorageWrapper } from "./db/localStorageWrapper.js";
import { Groups, groupObjType, groupValType } from "./modules/groups";
import { Permissions } from "./modules/permissions"; 

export type payloadType = {
  msgType: string,
  // when msgType = REQ_UPDATE_LINKED
  tempName?: string,
  srcIdkey?: string,
  newLinkedMembers?: groupObjType[],
  // when msgType = CONFIRM_UPDATE_LINKED
  existingGroups?: storageObjType[],
  existingData?: storageObjType[],
  // when msgType = REQ_CONTACT
  reqIdkey?: string,
  reqContactName?: string,
  reqContactGroups?: groupObjType[],
  // when msgType = CONFIRM_CONTACT
  contactName?: string,
  contactGroups?: groupObjType[],
  // when msgType = UPDATE_DATA
  key?: string,
  value?: any,
  // when msgType = UPDATE_GROUP, ADD_ADMIN, etc
  objectKey?: string,
  groupID?: string
  // when msgType = UPDATE_GROUP
  groupValue?: groupValType,
  // when msgType = LINK_GROUPS, ADD/REMOVE_PARENT/CHILD
  parentID?: string,
  childID?: string,
  // // when msgType = ADD/REMOVE_ADMIN
  adminID?: string,
  // // when msgType = ADD/REMOVE_WRITER
  writerID?: string,
};

type storageObjType = {
  key: string,
  value: any // FIXME groupObjType | dataObjType
};

export class Higher {
  // TODO make variables private
  static #SLASH   : string = "/";
  static #DATA    : string = "__data";
  static #LINKED  : string = "__linked";
  static #CONTACTS: string = "__contacts";
  static #OUTSTANDING_IDKEY: string = "__outstandingIdkey";

  // valid message types
  static REQ_UPDATE_LINKED    : string = "requestUpdateLinked";
  static CONFIRM_UPDATE_LINKED: string = "confirmUpdateLinked";
  static REQ_CONTACT          : string = "requestContact";
  static CONFIRM_CONTACT      : string = "confirmContact";
  static LINK_GROUPS          : string = "linkGroups";
  static ADD_PARENT           : string = "addParent";
  static ADD_CHILD            : string = "addChild";
  static ADD_WRITER           : string = "addWriter";
  static ADD_ADMIN            : string = "addAdmin";
  static REMOVE_PARENT        : string = "removeParent";
  static REMOVE_WRITER        : string = "removeWriter";
  static REMOVE_ADMIN         : string = "removeAdmin";
  static UPDATE_GROUP         : string = "updateGroup";
  static UPDATE_DATA          : string = "updateData";
  static DELETE_DEVICE        : string = "deleteDevice";
  static DELETE_GROUP         : string = "deleteGroup";
  static DELETE_DATA          : string = "deleteData";

  // default auth/unauth functions do nothing
  #defaultOnAuth  : () => void = () => {};
  #defaultOnUnauth: () => void = () => {};
  // default callback
  #defaultValidateCallback: (payloadType) => boolean = (payload) => {
    if (payload.key === null) return false;
    return true;
  };

  #storagePrefixes: string[] = [Groups.PREFIX];   //FIX: take groups out of here?
  #onAuth  : () => void;
  #onUnauth: () => void;
  #turnEncryptionOff: boolean;
  #validateCallback: (payloadType) => boolean;
  #validateCallbackMap: Map<string, (payloadType) => boolean> = new Map();
  #core: Core;
  #localStorageWrapper: LocalStorageWrapper;
  #eventEmitter: EventEmitter;
  #demuxFunc;
  #linkedGroupId: string;

  private constructor(
      // TODO type config
      config?
  ) {
    this.#onAuth = config?.onAuth ?? this.#defaultOnAuth;
    this.#onUnauth = config?.onUnauth ?? this.#defaultOnUnauth;
    this.#turnEncryptionOff = config?.turnEncryptionOff ?? false;
    this.#validateCallback = config?.validateCallback ?? this.#defaultValidateCallback;
    if (config?.storagePrefixes) {
      config.storagePrefixes.forEach((prefix) => {
        this.#storagePrefixes.push(prefix);
      });
    }
    this.#eventEmitter = new EventEmitter();
    // register listener for incoming messages
    this.#eventEmitter.on('coreMsg', async (
        { payload, sender }: { payload: string, sender: string }
    ) => {
      await this.#onMessage(JSON.parse(payload), sender);
    });
    this.#localStorageWrapper = new LocalStorageWrapper();
  }

  async #init(ip?: string, port?: string) {
    this.#core = await Core.create(this.#eventEmitter, this.#turnEncryptionOff, ip, port);
  }

  static async create(
      // TODO type config
      config?,
      ip?: string,
      port?: string
  ): Promise<Higher> {
    let higher = new Higher(config);
    await higher.#init(ip, port);
    return higher;
  }

  setStoragePrefixes(storagePrefixes: string[]) {
    storagePrefixes.forEach((prefix) => {
      this.#storagePrefixes.push(prefix);
    });
  }

  setOnAuth(onAuth: () => void) {
    this.#onAuth = onAuth;
  }

  setOnUnauth(onUnauth: () => void) {
    this.#onUnauth = onUnauth;
  }

  /* Error messages */
  
  #printBadMessageError(msgType: string) {
    console.log("----------ERROR unknown msgType: " + msgType);
  }
  
  #printBadPermissionsError() {
    console.log("----------ERROR insufficient permissions");
  }
  
  #printBadDataError() {
    console.log("----------ERROR data invariant violated");
  }
  
  #printBadContactError() {
    console.log("----------ERROR cannot add self as contact");
  }
  
  #printBadDataPermissionsError() {
    console.log("----------ERROR insufficient permissions for modifying data");
  }
  
  #printBadGroupPermissionsError() {
    console.log("----------ERROR insufficient permissions for modifying group");
  }

  /*
   ********************
   * Core interaction *
   ********************
   */
  
  async #sendMessage(dstIdkeys: string[], payload: payloadType) {
    await this.#core.sendMessage(dstIdkeys, JSON.stringify(payload));
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
  async #onMessage(
      payload: payloadType,
      sender: string
  ) {
    let permissionsOK = this.#checkPermissions(payload, sender); //TODO
    if (this.#demuxFunc === undefined) {
      this.#printBadMessageError(payload.msgType);
      return;
    }
    if (!permissionsOK) {
      this.#printBadPermissionsError();
      return;
    }
    if (!this.#validate(payload)) {
      this.#printBadDataError();
      return;
    }
    console.log("SUCCESS");
    await this.#demuxFunc(payload);
  }

  /*
   ***********
   * Devices *
   ***********
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
  async #initDevice(
      linkedName: string,
      linkedId?: string,
      deviceName?: string,
  ): Promise<{ idkey: string, linkedName: string }> {
    let idkey: string = await this.#core.olmWrapper.generateInitialKeys();
    console.log(idkey);

    if (!deviceName) {
      deviceName = undefined;
    }
    //add new group for device id
    if (!linkedId){
      linkedId = Groups.newGroup(linkedName, true, [idkey]);
    }
    Groups.newDevice(idkey, deviceName, linkedId);

    return {
      idkey: idkey,
      linkedName: linkedName,
    };
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
  #setOutstandingLinkIdkey(idkey: string) {
    this.#localStorageWrapper.set(Higher.#OUTSTANDING_IDKEY, idkey);
  }
  
  /**
   * Helper for retrieving temporary state to help with permission checks when
   * the current device has requested to be linked with another.
   *
   * @returns {string} the idkey with which this device has requested to link
   *
   * @private
   */
  #getOutstandingLinkIdkey(): string {
    return this.#localStorageWrapper.get(Higher.#OUTSTANDING_IDKEY);
  }
  
  /**
   * Clears temporary state.
   *
   * @private
   */
  #removeOutstandingLinkIdkey() {
    this.#localStorageWrapper.remove(Higher.#OUTSTANDING_IDKEY);
  }
  
  async #requestUpdateLinked(
      dstIdkey: string,
      srcIdkey: string,
      tempName: string,
      newLinkedMembers: groupObjType[]
  ) {
    await this.#sendMessage([dstIdkey], {
      msgType: Higher.REQ_UPDATE_LINKED,
      tempName: tempName,
      srcIdkey: srcIdkey,
      newLinkedMembers: newLinkedMembers,
    });
  }
  
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
  async #processUpdateLinkedRequest({ //TODO for refactor
      tempName,
      srcIdkey,
      newLinkedMembers
  }: {
      tempName: string,
      srcIdkey: string,
      newLinkedMembers: groupObjType[]
  }) {
    if (confirm(`Authenticate new LINKED group member?\n\tName: ${tempName}`)) {
      // get linked idkeys to update
      let linkedIdkeys: string[] = Groups.getDevices(this.#linkedGroupId);
      let linkedName: string = this.getLinkedName();
  
      /* UPDATE OLD SELF */
  
      // replace all occurrences of tempName with linkedName
      let updatedNewLinkedMembers: groupObjType[] = [];
      newLinkedMembers.forEach((newGroup) => {
        updatedNewLinkedMembers.push(Groups.groupReplace(newGroup, tempName, linkedName));
      });
  
      for (let newGroup of updatedNewLinkedMembers) {
        // FIXME assuming this group ID == linkedName (originally tempName)
        // when would this be false??
        if (newGroup.value.parents?.includes(Higher.#LINKED)) {
          // merge with existing linkedName group
          let nonLinkedParents: string[] = newGroup.value.parents.filter((x) => x != Higher.#LINKED);
          for (let nonLinkedParent of nonLinkedParents) {
            await this.#addParent(linkedName, nonLinkedParent, linkedIdkeys);
          }
          for (let child of newGroup.value.children) {
            await Groups.addToGroup(this.#linkedGroupId, [child]);
          }
        } else {
          await this.#updateGroup(newGroup.id, newGroup.value, linkedIdkeys);
        }
      }
  
      /* UPDATE NEW SELF */
  
      // delete old linkedName group
      await this.#deleteGroup(tempName, [srcIdkey]);
      // notify new group member of successful link and piggyback existing groups/data
      await this.#confirmUpdateLinked(Groups.getAllGroups(), this.getAllData(), [srcIdkey]);
  
      /* UPDATE OTHER */
  
      // notify contacts
      let allContactIdkeys: string[] = Groups.getDevices([Higher.#CONTACTS]);
      let contactNames: string[] = Groups.getDevices(Higher.#CONTACTS);
      for (let newGroup of updatedNewLinkedMembers) {
        if (newGroup.id === linkedName) {
          for (const child of newGroup.value.children) {
            await Groups.addToGroup(this.#linkedGroupId, [child]);
          }
        } else {
          for (const contactName of contactNames) {
            let contactIdkeys = Groups.getDevices([contactName]);
            await this.#updateGroup(newGroup.id, newGroup.value, contactIdkeys);
            await this.#addAdmin(newGroup.id, contactName, contactIdkeys);
          }
        }
      }
    }
  }
  
  async #confirmUpdateLinked(
      existingGroups: storageObjType[],
      existingData: storageObjType[],
      idkeys: string[]
  ) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.CONFIRM_UPDATE_LINKED,
      existingGroups: existingGroups,
      existingData: existingData,
    });
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
  #processConfirmUpdateLinked({
      existingGroups,
      existingData
  }: {
      existingGroups: storageObjType[],
      existingData: storageObjType[]
  }) {
    existingGroups.forEach(({ key, value }) => {
      this.#localStorageWrapper.set(key, value);
    });
    existingData.forEach(({ key, value }) => {
      this.#localStorageWrapper.set(key, value);
    });
    this.#removeOutstandingLinkIdkey();
    this.#onAuth();
  }
  
  /**
   * Get linked name.
   *
   * @returns {string}
   */
  getLinkedName(): string {
    return Groups.getGroupName(this.#linkedGroupId);
  }

  /**
   * 
   * Initializes device and its linked group.
   *
   * @param {?string} linkedName human-readable name (for contacts)
   * @param {?string} deviceName human-readable name (for self)
   * @returns {string}
   */
  async createDevice(
      linkedName: string = null,
      deviceName: string = null
  ): Promise<string> {
    let { idkey } = await this.#initDevice(linkedName, null, deviceName);
    this.#onAuth();
    return idkey;
  }

  /**
   * Initializes device and requests to link with existing device.
   *
   * @param {string} dstIdkey hex-formatted public key of device to link with
   * @param {?string} deviceName human-readable name (for self)
   * @returns {string}
   */
  async createLinkedDevice(
      dstIdkey: string,
      deviceName: string = null
  ): Promise<string> {
    if (dstIdkey !== null) {
      let { idkey, linkedName } = await this.#initDevice(null, deviceName);
      let linkedMembers = Groups.getAllSubgroups([linkedName]);
      // construct message that asks dstIdkey's device to link this device
      this.#setOutstandingLinkIdkey(dstIdkey);
      await this.#requestUpdateLinked(dstIdkey, idkey, linkedName, linkedMembers);
      return idkey;
    }
  }

  /**
   * Helper function for deleting the current device.
   *
   * @param {string} idkey current device's identity key
   */
  async #deleteDeviceLocally() {
    // notify all direct parents and contacts that this group should be removed
    // TODO impl pending state
    let idkey =  this.#core.olmWrapper.getIdkey();
    await Groups.deleteDevice(idkey);
    this.#localStorageWrapper.clear();
    this.#onUnauth();
  }
  
  async #deleteDeviceRemotely(idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.DELETE_DEVICE,
    });
  }

  /**
   * Deletes the current device's data and removes it's public key from 
   * the server.
   */
  async deleteThisDevice() {
    this.#deleteDeviceRemotely(this.getContacts())
    await Groups.deleteDevice(this.#core.olmWrapper.getIdkey());
  }
  
  /**
   * Deletes the device pointed to by idkey.
   *
   * @param {string} idkey hex-formatted public key
   */
  async deleteLinkedDevice(idkey: string) {
    await Groups.deleteDevice(idkey);
  }
  
  /**
   * Deletes all devices that are children of this device's linked group.
   */
  async deleteAllLinkedDevices() {
    for (let g in Groups.getDevices(Higher.#LINKED)) {
      Groups.deleteDevice(g);
    }
    
  }

  /**
   * Linked group getter.
   *
   * @returns {string[]}
   */
  getLinkedDevices(): string[] {
    return Groups.getDevices(Higher.#LINKED);
  }

  /*
   ************
   * Contacts *
   ************
   */
  
  async #requestContact(
      reqContactName: string,
      reqContactGroups: groupObjType[],
      idkeys: string[]
  ) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.REQ_CONTACT,
      reqIdkey: this.#core.olmWrapper.getIdkey(),
      reqContactName: reqContactName,
      reqContactGroups: reqContactGroups,
    });
  }
  
  async #confirmContact(
      contactName: string,
      contactGroups: groupObjType[],
      idkeys: string[]
  ) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.CONFIRM_CONTACT,
      contactName: contactName,
      contactGroups: contactGroups,
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
  async #processContactRequest({
      reqIdkey,
      reqContactName,
      reqContactGroups
  }: {
      reqIdkey: string,
      reqContactName: string,
      reqContactGroups: groupObjType[]
  }) {
    if (confirm(`Add new contact: ${reqContactName}?`)) {
      await this.#parseContactInfo(reqContactName, reqContactGroups);
      let linkedName = this.getLinkedName();
      await this.#confirmContact(linkedName, Groups.getAllSubgroups([linkedName]), [reqIdkey]);
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
  async #processConfirmContact({
      contactName,
      contactGroups
  }: {
      contactName: string,
      contactGroups: groupObjType[]
  }) {
    await this.#parseContactInfo(contactName, contactGroups);
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
  async #parseContactInfo(contactName: string, contactGroups: groupObjType[]) {
    let linkedName = this.getLinkedName();
    let linkedIdkeys = Groups.getDevices([Higher.#LINKED]);
  
    // check if "linked" backpointer will be replaced with "contact" backpointer
    let contactLevelIDs : string[] = [];
    for (let contactGroup of contactGroups) {
      let deepCopy = JSON.parse(JSON.stringify(contactGroup));
      if (Groups.groupContains(deepCopy, Higher.#LINKED)) {
        contactLevelIDs.push(deepCopy.id);
      }
    }
  
    for (let contactGroup of contactGroups) {
      let updatedContactGroup = Groups.groupReplace(contactGroup, Higher.#LINKED, Higher.#CONTACTS);
      // "linked" backpointer was replaced with "contact" backpointer
      // set contactLevel field = true
      if (contactLevelIDs.includes(updatedContactGroup.id)) {
        updatedContactGroup.value.contactLevel = true;
      }
      // create group and add admin for enabling future deletion of this contact + groups
      this.#addAdminInMem(updatedContactGroup.value.id, linkedName);
      await this.#updateGroup(updatedContactGroup.id, updatedContactGroup.value, linkedIdkeys);
    }
    
    await this.#linkGroups(Higher.#CONTACTS, contactName, linkedIdkeys);
  }
  
  /**
   * Shares own contact info and requests the contact info of contactIdkey.
   * TODO implement private contact discovery and return contact name.
   *
   * @param {string} contactIdkey hex-formatted public key
   */
  async addContact(contactIdkey: string) {
    // only add contact if not self
    let linkedName = this.getLinkedName();
    if (!Groups.isMember(contactIdkey, [linkedName])) {
      // piggyback own contact info when requesting others contact info
      await this.#requestContact(linkedName, Groups.getAllSubgroups([linkedName]), [contactIdkey]);
    } else {
      this.#printBadContactError();
    }
  }

  /**
   * Remove contact.
   *
   * @param {string} name contact name
   */
  async removeContact(name: string) {
    await this.#deleteGroup(name, Groups.getDevices([Higher.#LINKED]));
  }
  
  /**
   * Get all contacts.
   *
   * @returns {string[]}
   */
  getContacts(): string[] {
    return Groups.getDevices(Higher.#CONTACTS)
  }
  
  /**
   * Get pending contacts.
   * TODO implement pending list.
   *
   * @returns {string[]}
   */
  getPendingContacts(): string[] {
    return [];
  }

  /*
   ****************
   * Data methods *
   ****************
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
  #getDataKey(prefix: string, id: string): string {
    return Higher.#DATA + Higher.#SLASH + prefix + Higher.#SLASH + id + Higher.#SLASH;
  }
  
  /**
   * Get partial storage key for a particular data prefix.
   *
   * @param {string} prefix key prefix (app-specific)
   * @returns {string}
   *
   * @private
   */
  #getDataPrefix(prefix: string): string {
    return Higher.#DATA + Higher.#SLASH + prefix + Higher.#SLASH;
  }
  
  /**
   * Stores data value at data key (where data value has group information).
   *
   * @param {string} key data key
   * @param {Object} value data value
   *
   * @private
   */
  #updateDataLocally(
      { key, value }: { key: string, value: any }
  ) {
    this.#localStorageWrapper.set(key, value);
  }
  
  async #updateDataRemotely(key: string, value: any, idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.UPDATE_DATA,
      key: key,
      value: value,
    });
  }
  
  async #updateData(key: string, value: any, idkeys: string[]) {
    await this.#updateDataRemotely(key, value, idkeys);
    // TODO impl pending state
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
  async #setDataHelper(key: string, data: any, groupID: string) {
    // check permissions
    let idkey = this.#core.olmWrapper.getIdkey();
    if (!Permissions.hasWritePermissions(key, groupID)) {
      this.#printBadDataPermissionsError();
      return;
    }
    let value = {
      groupID: groupID,
      data: data,
    };
    if (!this.#validate({ key: key, value: value })) {
      this.#printBadDataError();
      return;
    }
    await this.#updateData(key, value, Groups.getDevices([groupID]));
  }
  
  /**
   * Deletes data key (and associated value).
   *
   * @param {string} key data key
   *
   * @private
   */
  #deleteDataLocally({ key }: { key: string }) {
    this.#localStorageWrapper.remove(key);
  }
  
  async #deleteDataRemotely(key: string, idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.DELETE_DATA,
      key: key,
    });
  }
  
  async #deleteData(key: string, idkeys: string[]) {
    await this.#deleteDataRemotely(key, idkeys);
    // TODO impl pending state
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
  async #removeDataHelper(
      key: string,
      curGroupID: string = null,
      toUnshareGroupID: string = null
  ) {
    if (curGroupID === null) {
      curGroupID = this.#localStorageWrapper.get(key)?.groupID;
    }
    if (curGroupID !== null) {
      let idkey = this.#core.olmWrapper.getIdkey();
      if (!Permissions.hasWritePermissions(key, curGroupID)) {
        this.#printBadDataPermissionsError();
        return;
      }
  
      // delete data from select devices only (unsharing)
      if (toUnshareGroupID !== null) {
        await this.#deleteData(key, Groups.getDevices([toUnshareGroupID]));
        return;
      }
  
      // delete data from all devices in group including current (removing data)
      await this.#deleteData(key, Groups.getDevices([curGroupID]));
    }
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
  // FIXME currently works on both payloadType and others; need to clean this up
  #validate(payload): boolean {
    // called on each interaction with the data store
    if (!this.#validateCallback(payload)) {
      return false;
    }
    
    // validate based on prefixes in payload keys
    let keys = payload.key?.split("/");
    if (keys === undefined) {
      // nothing else to check FIXME mismatch in expected types
      return true;
    }
    for (let i=0; i < keys.length; i++) {
      if (this.#validateCallbackMap.has(keys[i])) {
        let valFunc = this.#validateCallbackMap.get(keys[i]);
        if (!valFunc(payload)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Sets the callback function with which to perform message validation
   * for this application.
   *
   * TODO validate newValidateCallback to ensure it only takes one arg (payload)
   * and returns boolean.
   *
   * @param {callback} newValidateCallback new validation callback
   */
  setValidateCallback(callback: (payloadType) => boolean) {
    this.#validateCallback = callback;
  }

  setValidateCallbackForPrefix(prefix: string, callback: (payloadType) => boolean) {
    this.#validateCallbackMap.set(prefix, callback);
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
  async setData(prefix: string, id: string, data: any) {
    let existingData = this.getSingleData(prefix, id);
    if (existingData !== null) {
      await this.#setDataHelper(this.#getDataKey(prefix, id), data, existingData.groupID);
    } else {
      await this.#setDataHelper(this.#getDataKey(prefix, id), data, this.getLinkedName());
    }
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
  getSingleData(prefix: string, id: string): any {
    return this.#localStorageWrapper.get(this.#getDataKey(prefix, id))?.data ?? null;
  }

  getDataByPrefix(prefix: string): any[] {
    return this.#localStorageWrapper.getMany(this.#getDataPrefix(prefix));
  }

  getAllData(): { key: string, value: any }[] {
    let results = [];
    /**
     * FIX: wouldn't need this prefix if groups weren't included 
     * in appPrefixes definitions: how should we handle this? 
     * maybe also have "module/plug-in prefixes" that would get 
     * ignored on this call, are they necessary anywehre else?
     *  */ 
    let appPrefixes = this.#storagePrefixes.filter((x) => x != Groups.PREFIX);
    appPrefixes.forEach((appPrefix) => {
      this.#localStorageWrapper.getMany(this.#getDataPrefix(appPrefix)).forEach((dataObj) => {
        results.push({
          key: dataObj.key,
          value: dataObj.value,
        });
      });
    });
    return results;
  }

  /**
   * Removes the datum with prefix and id.
   *
   * @param {string} prefix data prefix
   * @param {string} id data id (app-specific)
   */
  async removeData(prefix: string, id: string) {
    await this.#removeDataHelper(this.#getDataKey(prefix, id));
  }

  /*
   *****************
   * Group methods *
   *****************
   */
  
  /**
   * Updates group with new value.
   *
   * @param {string} groupID group ID
   * @param {Object} value group value
   * 
   * @private
   */
  async #updateGroupLocally({
      groupID,
      groupValue
  }: {
      groupID: string,
      groupValue: groupValType
  }) {
    // cases that handle shared data where a subset of the members
    // do not already exist in this device's contacts list
    let contacts = this.getContacts();
    // if contactLevel = true but not in contacts, add
    if (groupValue.contactLevel && !contacts.includes(groupID)) {
      await Groups.addToGroup(Higher.#CONTACTS, [groupID]);
    }
    // if in contacts but contactLevel = false, make contactLevel = true
    if (!groupValue.contactLevel && contacts.includes(groupID)) {
      groupValue.contactLevel = true;
    }

    //FIX: use group lib, no idea how to abstract without exporting 
    // setGroup which we dont want, but cant just move to groups class
    Groups.importGroup(groupID, groupValue);
  }
  
  async #updateGroupRemotely(groupID: string, value: groupValType, idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.UPDATE_GROUP,
      groupID: groupID,
      groupValue: value,
    });
  }
  
  /**
   * Sends UPDATE_GROUP message to specified idkeys.
   *
   * @param {string} groupID id of group to add
   * @param {Object} value group value to add
   * @param {string[]} idkeys list of idkeys to add group on
   *
   * @private
   */
  async #updateGroup(groupID: string, value: groupValType, idkeys: string[]) {
    await this.#updateGroupRemotely(groupID, value, idkeys);
    // TODO impl pending state
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
  #linkGroupsLocally({ parentID, childID }: { parentID: string, childID: string }) {
    this.#addParentLocally({ groupID: childID, parentID: parentID });
    this.#addChildLocally({ groupID: parentID, childID: childID });
  }
  
  async #linkGroupsRemotely(parentID: string, childID: string, idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.LINK_GROUPS,
      parentID: parentID,
      childID: childID,
    });
  }
  
  async #linkGroups(parentID: string, childID: string, idkeys: string[]) {
    await this.#linkGroupsRemotely(parentID, childID, idkeys);
    // TODO impl pending state
  }

  /**
   * Unlinks the group denoted by groupID from its parents and children
   * and then deletes the group itself.
   *
   * @param {string} groupID ID of group to delete
   *
   * @private
   */
  #deleteGroupLocally({ groupID }: { groupID: string }) {
    // delete group
    Groups.removeGroup(groupID);
    // TODO more GC e.g. when contact's childrens list is empty -> remove contact
    // TODO if group is a device, delete session associated with it
  }
  
  async #deleteGroupRemotely(groupID: string, idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.DELETE_GROUP,
      groupID: groupID,
    });
  }
  
  async #deleteGroup(groupID: string, idkeys: string[]) {
    await this.#deleteGroupRemotely(groupID, idkeys);
    // TODO impl pending state
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
  async #unlinkAndDeleteGroup(groupID: string, parentID: string, idkeys: string[]) {
    // unlink parent
    await this.#removeParent(groupID, parentID, idkeys);
    // delete parent
    await this.#deleteGroup(parentID, idkeys);
  }  

  #listRemoveCallback(ID: string, newList: string[]): string[] {
    let idx = newList.indexOf(ID);
    if (idx !== -1) newList.splice(idx, 1);
    return newList;
  }
  
  #listAddCallback(ID: string, newList: string[]): string[] {
    // deduplicate: only add ID if doesn't already exist in list
    if (newList.indexOf(ID) === -1) newList.push(ID);
    return newList;
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
  #addChildLocally({
      groupID,
      childID
  }: {
      groupID: string,
      childID: string
  }): groupValType {
    return Groups.updateGroupField("CHILDREN", groupID, childID, this.#listAddCallback);
  }
  
  async #addChildRemotely(groupID: string, childID: string, idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.ADD_CHILD,
      groupID: groupID,
      childID: childID,
    });
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
  #addParentLocally({
      groupID,
      parentID
  }: {
      groupID: string,
      parentID: string
  }): groupValType {
    return Groups.updateGroupField("PARENTS", groupID, parentID, this.#listAddCallback);
  }
  
  async #addParentRemotely(groupID: string, parentID: string, idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.ADD_PARENT,
      groupID: groupID,
      parentID: parentID,
    });
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
  async #addParent(groupID: string, parentID: string, idkeys: string[]) {
    await this.#addParentRemotely(groupID, parentID, idkeys);
    // TODO impl pending state
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
  #removeParentLocally({
      groupID,
      parentID
  }: {
      groupID: string,
      parentID: string
  }): groupValType {
    return Groups.updateGroupField("PARENTS", groupID, parentID, this.#listRemoveCallback);
  }
  
  async #removeParentRemotely(groupID: string, parentID: string, idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.REMOVE_PARENT,
      groupID: groupID,
      parentID: parentID,
    });
  }
  
  async #removeParent(groupID: string, parentID: string, idkeys: string[]) {
    await this.#removeParentRemotely(groupID, parentID, idkeys);
    // TODO impl pending state
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
  #addAdminInMem(key: string, adminId: string) {
    Permissions.addAdmin(key, [adminId]);
  }
  
  /**
   * Adds an additional admin (ID) to an existing group's admins list.
   *
   * @param {string} ObjectKey key of data object
   * @param {string} adminID ID of admin to add
   * @returns {Object}
   *
   * @private
   */
  #addAdminLocally({
      ObjectKey,
      adminID
  }: {
      ObjectKey: string,
      adminID: string
  }) {
    Permissions.addAdmin(ObjectKey, [adminID]);
  }
  
  async #addAdminRemotely(ObjectKey: string, adminID: string, idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.ADD_ADMIN,
      key: ObjectKey,
      adminID: adminID,
    });
  }
  
  /**
   * Adds admin locally and remotely on all devices in group (specified by idkeys
   * parameter).
   *
   * @param {string} ObjectKey key of data object
   * @param {string} adminID ID of admin to add
   * @param {string[]} idkeys devices to remotely make this modification on
   *
   * @private
   */
  async #addAdmin(groupID: string, adminID: string, idkeys: string[]) {
    await this.#addAdminRemotely(groupID, adminID, idkeys);
    // TODO impl pending state
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
  #removeAdminLocally({
      objectKey,
      adminID
  }: {
      objectKey: string,
      adminID: string
  }) {
    Permissions.removeAdmin(objectKey, adminID)
  }
  
  async #removeAdminRemotely(key: string, adminID: string, idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.REMOVE_ADMIN,
      objectKey: key,
      adminID: adminID,
    });
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
  async #removeAdmin(prefix: string, id: string, toUnshareGroupID: string) {
    let { curGroupID, errCode } = this.#unshareChecks(prefix, id, toUnshareGroupID);
    if (errCode === 0) {
      await this.#removeAdminRemotely(curGroupID, toUnshareGroupID, Groups.getDevices([curGroupID]));
      // TODO impl pending state
    }
  }
  
  /**
   * Adds writer to writers list of a group (modifies group in place).
   *
   * @param {Object} objectKey group value with admins list to update
   * @param {string} writerID id of writer to add
   *
   * @private
   */
  #addWriterLocally({
    objectKey,
      writerID
  }: {
    objectKey: string,
      writerID: string
  }) {
    Permissions.addWriter(objectKey, [writerID])
  }
  
  async #addWriterRemotely(key: string, writerID: string, idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.ADD_WRITER,
      objectKey: key,
      writerID: writerID,
    });
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
  async #addWriter(groupID: string, writerID: string, idkeys: string[]) {
    await this.#addWriterRemotely(groupID, writerID, idkeys);
    // TODO impl pending state
  }
  
  /**
   * Removes a writer (ID or idkey) from an existing group's writers list.
   * Noop if writer did not exist in the writers list.
   *
   * @param {string} objectKey key of modified object
   * @param {string} writerID ID of writer to remove
   * @returns {Object}
   *
   * @private
   */
  #removeWriterLocally({
    objectKey,
      writerID
  }: {
    objectKey: string,
    writerID: string
  }) {
    return Permissions.removeWriter(objectKey, writerID);
  }
  
  async #removeWriterRemotely(key: string, writerID: string, idkeys: string[]) {
    await this.#sendMessage(idkeys, {
      msgType: Higher.REMOVE_WRITER,
      objectKey: key,
      writerID: writerID,
    });
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
  async #removeWriter(prefix: string, id: string, toUnshareGroupID: string) {
    let { curGroupID, errCode } = this.#unshareChecks(prefix, id, toUnshareGroupID);
    if (errCode === 0) {
      await this.#removeWriterRemotely(curGroupID, toUnshareGroupID, Groups.getDevices([curGroupID]));
      // TODO impl pending state
    }
  }

  /*
   *************************
   * Sharing and unsharing *
   *************************
   */

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
  async #shareData(prefix: string, id: string, toShareGroupID: string) {
    let idkey = this.#core.olmWrapper.getIdkey();
    let key = this.#getDataKey(prefix, id);
    let value = this.#localStorageWrapper.get(key);
    let curGroupID = value?.perms ?? null;

    Permissions.addReader(key, [toShareGroupID])
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
  #unshareChecks(prefix: string, id: string, toUnshareGroupID: string) {
    let idkey = this.#core.olmWrapper.getIdkey();
    let key = this.#getDataKey(prefix, id);
    let value = this.#localStorageWrapper.get(key);
    let curGroupID = value?.groupID ?? null;
  
    let retval = {
      key: key,
      value: value,
      curGroupID: curGroupID,
    };
  
    // check that current device can modify group
    if (!Permissions.hasAdminPermissions(key, idkey)) {
      this.#printBadGroupPermissionsError();
      return { ...retval, errCode: -1 };
    }
  
    // check that data is currently shared with that group
    if (!Permissions.hasReadPermissions(toUnshareGroupID, [curGroupID])) {
      return { ...retval, errCode: -1 };
    }
  
    // prevent device from unsharing with self 
    // what if you get multiple links to self and just
    // want to unshare one?
    // TODO when would it make sense to allow this?
    if (Groups.isMember(toUnshareGroupID, [this.getLinkedName()])) {
      return { ...retval, errCode: -1 };
    }
  
    return { ...retval, errCode: 0 };
  }

  
  // demultiplexing map from message types to functions
  #demuxMap = {
    [Higher.REQ_UPDATE_LINKED]:     this.#processUpdateLinkedRequest,
    [Higher.CONFIRM_UPDATE_LINKED]: this.#processConfirmUpdateLinked,
    [Higher.REQ_CONTACT]:           this.#processContactRequest,
    [Higher.CONFIRM_CONTACT]:       this.#processConfirmContact,
    [Higher.LINK_GROUPS]:           this.#linkGroupsLocally,
    [Higher.ADD_PARENT]:            this.#addParentLocally,
    [Higher.ADD_CHILD]:             this.#addChildLocally,
    [Higher.ADD_WRITER]:            this.#addWriterLocally,
    [Higher.ADD_ADMIN]:             this.#addAdminLocally,
    [Higher.REMOVE_PARENT]:         this.#removeParentLocally,
    [Higher.REMOVE_WRITER]:         this.#removeWriterLocally,
    [Higher.REMOVE_ADMIN]:          this.#removeAdminLocally,
    [Higher.UPDATE_GROUP]:          this.#updateGroupLocally,
    [Higher.UPDATE_DATA]:           this.#updateDataLocally,
    [Higher.DELETE_DEVICE]:         this.#deleteDeviceLocally,
    [Higher.DELETE_GROUP]:          this.#deleteGroupLocally,
    [Higher.DELETE_DATA]:           this.#deleteDataLocally,
  };

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

  #checkPermissions(
      payload: payloadType,
      srcIdkey: string
  ): boolean {
    let permissionsOK = false;
  
    switch(payload.msgType) {
      /* special checks */
      case Higher.CONFIRM_UPDATE_LINKED: {
        if (this.#getOutstandingLinkIdkey() === srcIdkey) {
          permissionsOK = true;
        }
        break;
      /* admin checks */
      } case Higher.LINK_GROUPS: {
        if (Permissions.hasAdminPermissions(Groups.getKey(payload.parentID), srcIdkey) && Permissions.hasAdminPermissions(Groups.getKey(payload.childID), srcIdkey)) {
          permissionsOK = true;
        }
        break;
      } case Higher.DELETE_DEVICE: {
        if (Permissions.hasAdminPermissions(Groups.getKey(this.#core.olmWrapper.getIdkey()), srcIdkey)) {
          permissionsOK = true;
        }
        break;
      } case Higher.UPDATE_GROUP: {
        // TODO what was this case for again? need to somehow check that
        // can modify all parent groups of a group? but wouldn't that be
        // more like ADD_CHILD?
        if (Permissions.hasAdminPermissions(Groups.getKey(payload.groupID), srcIdkey)) {
          permissionsOK = true;
        }
        // check that group being created is being created by a device
        // with admin privs
        if (Permissions.hasAdminPermissions(Groups.getKey(payload.groupID), srcIdkey)) {
          permissionsOK = true;
        }
        break;
      }
      case Higher.ADD_PARENT:
      case Higher.REMOVE_PARENT: {
        // ok to add parent (e.g. send this group data)
        // not ok to add child (e.g. have this group send data to me)
        if (Permissions.hasAdminPermissions(Groups.getKey(payload.parentID), srcIdkey)) {
          permissionsOK = true;
        }
        break;
      }
      case Higher.ADD_CHILD:
      case Higher.ADD_WRITER:
      case Higher.REMOVE_WRITER:
      case Higher.ADD_ADMIN:
      case Higher.REMOVE_ADMIN: {
        if (Permissions.hasAdminPermissions(payload.key, srcIdkey)) { 
          permissionsOK = true;
        }
        break;
      } case Higher.DELETE_GROUP: {
        if (Permissions.hasAdminPermissions(payload.key, srcIdkey)) {
          permissionsOK = true;
        }
        break;
      /* writer checks */
      } case Higher.UPDATE_DATA: {
        if (Permissions.hasWritePermissions(payload.key, srcIdkey)) {
          permissionsOK = true;
        }
        break;
      } case Higher.DELETE_DATA: {
        if (Permissions.hasWritePermissions(payload.key, srcIdkey)) {
          permissionsOK = true;
        }
        break;
      }
      case Higher.REQ_UPDATE_LINKED:
      case Higher.REQ_CONTACT:
      case Higher.CONFIRM_CONTACT:
        permissionsOK = true;
        break;
      default:
    }

    this.#demuxFunc = this.#demuxMap[payload.msgType];
  
    return permissionsOK;
  }

  /**
   * Allow application to share particular data object with another set of devices
   * with read privileges.
   *
   * @param {string} prefix app prefix for this data object
   * @param {string} id data object id
   * @param {string} toShareGroupID group to grant read privileges to
   */
  async grantReaderPrivs(prefix: string, id: string, toShareGroupID: string) {
    let key = this.#getDataKey(prefix, id)
    await Permissions.addReader(key, [toShareGroupID]);

    // 
  }
  
  /**
   * Allow application to share particular data object with another set of devices
   * with read/write privileges.
   *
   * @param {string} prefix app prefix for this data object
   * @param {string} id data object id
   * @param {string} toShareGroupID group to grant read/write privileges to
   */
  async grantWriterPrivs(prefix: string, id: string, toShareGroupID: string) {
    let key = this.#getDataKey(prefix, id)
    Permissions.addWriter(key, [toShareGroupID]);
  }
  
  /**
   * Allow application to share particular data object with another set of devices
   * with read/write/admin privileges.
   *
   * @param {string} prefix app prefix for this data object
   * @param {string} id data object id
   * @param {string} toShareGroupID group to grant read/write/admin privileges to
   */
  async grantAdminPrivs(prefix: string, id: string, toShareGroupID: string) {
    let key = this.#getDataKey(prefix, id)
    Permissions.addAdmin(key, [toShareGroupID]);
  }
  
  /**
   * Remove member from the relevant group's writers list.
   *
   * @param {string} prefix app-specific data prefix
   * @param {string} id data object id
   * @param {string} toUnshareGroupID id of member to revoke write privileges of
   */
  async revokeWriterPrivs(prefix: string, id: string, toUnshareGroupID: string) {
    let key = this.#getDataKey(prefix, id)
    Permissions.removeWriter(key, toUnshareGroupID);
  }
  
  /**
   * Remove member from the relevant group's admins list.
   *
   * @param {string} prefix app-specific data prefix
   * @param {string} id data object id
   * @param {string} toUnshareGroupID id of member to revoke admin privileges of
   */
  async revokeAdminPrivs(prefix: string, id: string, toUnshareGroupID: string) {
    let key = this.#getDataKey(prefix, id)
    Permissions.removeAdmin(key, toUnshareGroupID);
  }
  
  /**
   * Remove member from all of the relevant group's lists.
   *
   * @param {string} prefix app-specific data prefix
   * @param {string} id data object id
   * @param {string} toUnshareGroupID id of member to revoke privileges of
   */
  async revokeAllPrivs(prefix: string, id: string, toUnshareGroupID: string) {
    let { key, value, curGroupID, errCode } = this.#unshareChecks(prefix, id, toUnshareGroupID);
    Permissions.unshareData(key, toUnshareGroupID);
  }
}
