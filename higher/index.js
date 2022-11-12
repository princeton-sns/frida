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
// TODO instead of using this.core.olmWrapper.getIdkey() everywhere, idkey is not 
// expected to change so just set some object state once a device is
// created (could still be in olmWrapper)
// TODO need new special name for LINKED group (confusing when linking non-LINKED groups)
import EventEmitter from "events";
import { Core } from "../core/client";
import { LocalStorageWrapper } from "./db/localStorageWrapper.js";
/* doubly-linked tree, allows cycles */
const NAME = "name";
const CONTACT_LEVEL = "contactLevel";
const PARENTS = "parents";
const CHILDREN = "children";
const ADMINS = "admins";
const WRITERS = "writers";
// readers list isn't necessary, any member that isn't an admin
// or writer can be assumed to be a reader
// TODO also deduplicate admins and writers (any writer who is also an
// admin can _just_ exist in the admin group, since admin abilities are a
// superset of writer abilities)
class Key {
    name;
    contactLevel;
    parents;
    admins;
    writers;
    constructor(name, contactLevel, parents, admins, writers) {
        this.name = name;
        this.contactLevel = contactLevel;
        this.parents = parents;
        this.admins = admins;
        this.writers = writers;
    }
}
class Group {
    name;
    contactLevel;
    parents;
    children;
    admins;
    writers;
    constructor(name, contactLevel, parents, children, admins, writers) {
        this.name = name;
        this.contactLevel = contactLevel;
        this.parents = parents;
        this.children = children;
        this.admins = admins;
        this.writers = writers;
    }
}
export class Higher {
    // TODO make variables private
    static SLASH = "/";
    static DATA = "__data";
    static GROUP = "__group";
    static LINKED = "__linked";
    static CONTACTS = "__contacts";
    static OUTSTANDING_IDKEY = "__outstandingIdkey";
    // valid message types
    static REQ_UPDATE_LINKED = "requestUpdateLinked";
    static CONFIRM_UPDATE_LINKED = "confirmUpdateLinked";
    static REQ_CONTACT = "requestContact";
    static CONFIRM_CONTACT = "confirmContact";
    static LINK_GROUPS = "linkGroups";
    static ADD_PARENT = "addParent";
    static ADD_CHILD = "addChild";
    static ADD_WRITER = "addWriter";
    static ADD_ADMIN = "addAdmin";
    static REMOVE_PARENT = "removeParent";
    static REMOVE_WRITER = "removeWriter";
    static REMOVE_ADMIN = "removeAdmin";
    static UPDATE_GROUP = "updateGroup";
    static UPDATE_DATA = "updateData";
    static DELETE_DEVICE = "deleteDevice";
    static DELETE_GROUP = "deleteGroup";
    static DELETE_DATA = "deleteData";
    // default auth/unauth functions do nothing
    defaultOnAuth = () => { };
    defaultOnUnauth = () => { };
    // default callback
    defaultValidateCallback = (payload) => {
        console.log("validating payload... " + JSON.stringify(payload));
        return true;
    };
    storagePrefixes = [Higher.GROUP];
    onAuth;
    onUnauth;
    turnEncryptionOff;
    validateCallback;
    core;
    localStorageWrapper;
    eventEmitter;
    demuxFunc;
    constructor(
    // TODO type config
    config, ip, port) {
        this.onAuth = config.onAuth ?? this.defaultOnAuth;
        this.onUnauth = config.onUnauth ?? this.defaultOnUnauth;
        this.turnEncryptionOff = config.turnEncryptionOff ?? false;
        this.validateCallback = config.validateCallback ?? this.defaultValidateCallback;
        if (config.storagePrefixes) {
            config.storagePrefixes.forEach((prefix) => {
                this.storagePrefixes.push(prefix);
            });
        }
        this.eventEmitter = new EventEmitter();
        // register listener for incoming messages
        this.eventEmitter.on('coreMsg', async ({ payload, sender }) => {
            await this.#onMessage(payload, sender);
        });
        this.core = new Core(this.eventEmitter, this.turnEncryptionOff, ip, port);
        this.localStorageWrapper = new LocalStorageWrapper();
    }
    async init() {
        await this.core.init();
    }
    /* Error messages */
    #printBadMessageError(msgType) {
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
    async #onMessage(payload, sender) {
        let permissionsOK = this.#checkPermissions(payload, sender);
        if (this.demuxFunc === undefined) {
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
        await this.demuxFunc(payload);
    }
    /**
     * Resolves a list of one or more group IDs to a list of public keys.
     *
     * @param {string[]} ids group IDs to resolve
     * @return {string[]}
     *
     * @private
     */
    #resolveIDs(ids) {
        let idkeys = [];
        ids.forEach((id) => {
            let group = this.#getGroup(id);
            if (group !== null) {
                if (this.#isKey(group)) {
                    idkeys.push(id);
                }
                else {
                    idkeys = idkeys.concat(this.#resolveIDs(group.children));
                }
            }
        });
        return idkeys;
    }
    /**
     * Helper function for determining if resolveIDs has hit it's base case or not.
     *
     * @param {Object} group a group
     * @returns {boolean}
     *
     * @private
     */
    #isKey(group) {
        if (group.children) {
            return false;
        }
        return true;
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
    async #initDevice(linkedName, deviceName) {
        let idkey = await this.core.olmWrapper.generateInitialKeys();
        console.log(idkey);
        // enforce that linkedName exists; deviceName is not necessary
        if (!linkedName) {
            linkedName = crypto.randomUUID();
        }
        if (!deviceName) {
            deviceName = null;
        }
        this.#createGroup(Higher.LINKED, linkedName, false, [], [linkedName], [linkedName], [linkedName]);
        this.#createGroup(linkedName, null, false, [Higher.LINKED], [idkey], [linkedName], [linkedName]);
        this.#createKey(idkey, deviceName, false, [linkedName], [linkedName], [linkedName]);
        this.#createGroup(Higher.CONTACTS, null, false, [], [], [linkedName], [linkedName]);
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
    #setOutstandingLinkIdkey(idkey) {
        this.localStorageWrapper.set(Higher.OUTSTANDING_IDKEY, idkey);
    }
    /**
     * Helper for retrieving temporary state to help with permission checks when
     * the current device has requested to be linked with another.
     *
     * @returns {string} the idkey with which this device has requested to link
     *
     * @private
     */
    #getOutstandingLinkIdkey() {
        return this.localStorageWrapper.get(Higher.OUTSTANDING_IDKEY);
    }
    /**
     * Clears temporary state.
     *
     * @private
     */
    #removeOutstandingLinkIdkey() {
        this.localStorageWrapper.remove(Higher.OUTSTANDING_IDKEY);
    }
    async #requestUpdateLinked(dstIdkey, srcIdkey, tempName, newLinkedMembers) {
        await this.core.sendMessage([dstIdkey], {
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
    async #processUpdateLinkedRequest({ tempName, srcIdkey, newLinkedMembers }) {
        if (confirm(`Authenticate new LINKED group member?\n\tName: ${tempName}`)) {
            // get linked idkeys to update
            let linkedIdkeys = this.#resolveIDs([Higher.LINKED]);
            let linkedName = this.getLinkedName();
            /* UPDATE OLD SELF */
            // replace all occurrences of tempName with linkedName
            let updatedNewLinkedMembers = [];
            newLinkedMembers.forEach((newGroup) => {
                updatedNewLinkedMembers.push(this.#groupReplace(newGroup, tempName, linkedName));
            });
            for (let newGroup of updatedNewLinkedMembers) {
                // FIXME assuming this group ID == linkedName (originally tempName)
                // when would this be false??
                if (newGroup.value.parents.includes(Higher.LINKED)) {
                    // merge with existing linkedName group
                    let nonLinkedParents = newGroup.value.parents.filter((x) => x != Higher.LINKED);
                    for (let nonLinkedParent of nonLinkedParents) {
                        await this.#addParent(linkedName, nonLinkedParent, linkedIdkeys);
                    }
                    for (let child of newGroup.value.children) {
                        await this.#addChild(linkedName, child, linkedIdkeys);
                    }
                }
                else {
                    await this.#updateGroup(newGroup.id, newGroup.value, linkedIdkeys);
                }
            }
            /* UPDATE NEW SELF */
            // delete old linkedName group
            await this.#deleteGroup(tempName, [srcIdkey]);
            // notify new group member of successful link and piggyback existing groups/data
            await this.#confirmUpdateLinked(this.#getAllGroups(), this.getAllData(), [srcIdkey]);
            /* UPDATE OTHER */
            // notify contacts
            let allContactIdkeys = this.#resolveIDs([Higher.CONTACTS]);
            let contactNames = this.#getChildren(Higher.CONTACTS);
            for (let newGroup of updatedNewLinkedMembers) {
                if (newGroup.id === linkedName) {
                    for (const child of newGroup.value.children) {
                        await this.#addChild(linkedName, child, allContactIdkeys);
                    }
                }
                else {
                    for (const contactName of contactNames) {
                        let contactIdkeys = this.#resolveIDs([contactName]);
                        await this.#updateGroup(newGroup.id, newGroup.value, contactIdkeys);
                        await this.#addAdmin(newGroup.id, contactName, contactIdkeys);
                    }
                }
            }
        }
    }
    async #confirmUpdateLinked(existingGroups, existingData, idkeys) {
        await this.core.sendMessage(idkeys, {
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
    #processConfirmUpdateLinked({ existingGroups, existingData }) {
        existingGroups.forEach(({ key, value }) => {
            this.localStorageWrapper.set(key, value);
        });
        existingData.forEach(({ key, value }) => {
            this.localStorageWrapper.set(key, value);
        });
        this.#removeOutstandingLinkIdkey();
        this.onAuth();
    }
    /**
     * Get linked name.
     *
     * @returns {string}
     */
    getLinkedName() {
        return this.#getGroup(Higher.LINKED)?.name ?? null;
    }
    /**
     * Initializes device and its linked group.
     *
     * @param {?string} linkedName human-readable name (for contacts)
     * @param {?string} deviceName human-readable name (for self)
     * @returns {string}
     */
    async createDevice(linkedName = null, deviceName = null) {
        let { idkey } = await this.#initDevice(linkedName, deviceName);
        this.onAuth();
        return idkey;
    }
    /**
     * Initializes device and requests to link with existing device.
     *
     * @param {string} dstIdkey hex-formatted public key of device to link with
     * @param {?string} deviceName human-readable name (for self)
     * @returns {string}
     */
    async createLinkedDevice(dstIdkey, deviceName = null) {
        if (dstIdkey !== null) {
            let { idkey, linkedName } = await this.#initDevice(null, deviceName);
            let linkedMembers = this.#getAllSubgroups([linkedName]);
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
        let idkey = this.core.olmWrapper.getIdkey();
        await this.#deleteGroup(idkey, this.#resolveIDs(this.#getParents(idkey).concat([Higher.CONTACTS])));
        this.core.disconnect();
        this.localStorageWrapper.clear();
        this.onUnauth();
    }
    async #deleteDeviceRemotely(idkeys) {
        await this.core.sendMessage(idkeys, {
            msgType: Higher.DELETE_DEVICE,
        });
    }
    async #deleteDevice(idkeys) {
        await this.#deleteDeviceRemotely(idkeys);
        // TODO impl pending state
    }
    /**
     * Deletes the current device's data and removes it's public key from
     * the server.
     */
    async deleteThisDevice() {
        await this.#deleteDevice([this.core.olmWrapper.getIdkey()]);
    }
    /**
     * Deletes the device pointed to by idkey.
     *
     * @param {string} idkey hex-formatted public key
     */
    async deleteLinkedDevice(idkey) {
        await this.#deleteDevice([idkey]);
    }
    /**
     * Deletes all devices that are children of this device's linked group.
     */
    async deleteAllLinkedDevices() {
        await this.#deleteDevice(this.#resolveIDs([Higher.LINKED]));
    }
    /**
     * Linked group getter.
     *
     * @returns {string[]}
     */
    getLinkedDevices() {
        return this.#resolveIDs([Higher.LINKED]);
    }
    /*
     ************
     * Contacts *
     ************
     */
    async #requestContact(reqContactName, reqContactGroups, idkeys) {
        await this.core.sendMessage(idkeys, {
            msgType: Higher.REQ_CONTACT,
            reqIdkey: this.core.olmWrapper.getIdkey(),
            reqContactName: reqContactName,
            reqContactGroups: reqContactGroups,
        });
    }
    async #confirmContact(contactName, contactGroups, idkeys) {
        await this.core.sendMessage(idkeys, {
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
    async #processContactRequest({ reqIdkey, reqContactName, reqContactGroups }) {
        if (confirm(`Add new contact: ${reqContactName}?`)) {
            await this.#parseContactInfo(reqContactName, reqContactGroups);
            let linkedName = this.getLinkedName();
            await this.#confirmContact(linkedName, this.#getAllSubgroups([linkedName]), [reqIdkey]);
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
    async #processConfirmContact({ contactName, contactGroups }) {
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
    async #parseContactInfo(contactName, contactGroups) {
        let linkedName = this.getLinkedName();
        let linkedIdkeys = this.#resolveIDs([Higher.LINKED]);
        // check if "linked" backpointer will be replaced with "contact" backpointer
        let contactLevelIDs = [];
        for (let contactGroup of contactGroups) {
            let deepCopy = JSON.parse(JSON.stringify(contactGroup));
            if (this.#groupContains(deepCopy, Higher.LINKED)) {
                contactLevelIDs.push(deepCopy.id);
            }
        }
        for (let contactGroup of contactGroups) {
            let updatedContactGroup = this.#groupReplace(contactGroup, Higher.LINKED, Higher.CONTACTS);
            // "linked" backpointer was replaced with "contact" backpointer
            // set contactLevel field = true
            if (contactLevelIDs.includes(updatedContactGroup.id)) {
                updatedContactGroup.value.contactLevel = true;
            }
            // create group and add admin for enabling future deletion of this contact + groups
            this.#addAdminInMem(updatedContactGroup.value, linkedName);
            await this.#updateGroup(updatedContactGroup.id, updatedContactGroup.value, linkedIdkeys);
        }
        await this.#linkGroups(Higher.CONTACTS, contactName, linkedIdkeys);
    }
    /**
     * Shares own contact info and requests the contact info of contactIdkey.
     * TODO implement private contact discovery and return contact name.
     *
     * @param {string} contactIdkey hex-formatted public key
     */
    async addContact(contactIdkey) {
        // only add contact if not self
        let linkedName = this.getLinkedName();
        if (!this.#isMember(contactIdkey, [linkedName])) {
            // piggyback own contact info when requesting others contact info
            await this.#requestContact(linkedName, this.#getAllSubgroups([linkedName]), [contactIdkey]);
        }
        else {
            this.#printBadContactError();
        }
    }
    /**
     * Remove contact.
     *
     * @param {string} name contact name
     */
    async removeContact(name) {
        await this.#deleteGroup(name, this.#resolveIDs([Higher.LINKED]));
    }
    /**
     * Get all contacts.
     *
     * @returns {string[]}
     */
    getContacts() {
        return this.#getChildren(Higher.CONTACTS);
    }
    /**
     * Get pending contacts.
     * TODO implement pending list.
     *
     * @returns {string[]}
     */
    getPendingContacts() {
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
    #getDataKey(prefix, id) {
        return Higher.DATA + Higher.SLASH + prefix + Higher.SLASH + id + Higher.SLASH;
    }
    /**
     * Get partial storage key for a particular data prefix.
     *
     * @param {string} prefix key prefix (app-specific)
     * @returns {string}
     *
     * @private
     */
    #getDataPrefix(prefix) {
        return Higher.DATA + Higher.SLASH + prefix + Higher.SLASH;
    }
    /**
     * Stores data value at data key (where data value has group information).
     *
     * @param {string} key data key
     * @param {Object} value data value
     *
     * @private
     */
    #updateDataLocally({ key, dataValue }) {
        this.localStorageWrapper.set(key, dataValue);
    }
    async #updateDataRemotely(key, value, idkeys) {
        await this.core.sendMessage(idkeys, {
            msgType: Higher.UPDATE_DATA,
            key: key,
            dataValue: value,
        });
    }
    async #updateData(key, value, idkeys) {
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
    async #setDataHelper(key, data, groupID) {
        // check permissions
        let idkey = this.core.olmWrapper.getIdkey();
        if (!this.#hasWriterPriv(idkey, groupID)) {
            this.#printBadDataPermissionsError();
            return;
        }
        await this.#updateData(key, {
            groupID: groupID,
            data: data,
        }, this.#resolveIDs([groupID]));
    }
    /**
     * Deletes data key (and associated value).
     *
     * @param {string} key data key
     *
     * @private
     */
    #deleteDataLocally({ key }) {
        this.localStorageWrapper.remove(key);
    }
    async #deleteDataRemotely(key, idkeys) {
        await this.core.sendMessage(idkeys, {
            msgType: Higher.DELETE_DATA,
            key: key,
        });
    }
    async #deleteData(key, idkeys) {
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
    async #removeDataHelper(key, curGroupID = null, toUnshareGroupID = null) {
        if (curGroupID === null) {
            curGroupID = this.localStorageWrapper.get(key)?.groupID;
        }
        if (curGroupID !== null) {
            let idkey = this.core.olmWrapper.getIdkey();
            if (!this.#hasWriterPriv(idkey, curGroupID)) {
                this.#printBadDataPermissionsError();
                return;
            }
            // delete data from select devices only (unsharing)
            if (toUnshareGroupID !== null) {
                await this.#deleteData(key, this.#resolveIDs([toUnshareGroupID]));
                return;
            }
            // delete data from all devices in group including current (removing data)
            await this.#deleteData(key, this.#resolveIDs([curGroupID]));
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
    #validate(payload) {
        return this.validateCallback(payload);
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
    setValidateCallback(callback) {
        this.validateCallback = callback;
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
    async setData(prefix, id, data) {
        await this.#setDataHelper(this.#getDataKey(prefix, id), data, this.getLinkedName());
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
    getSingleData(prefix, id) {
        return this.localStorageWrapper.get(this.#getDataKey(prefix, id))?.data ?? null;
    }
    getDataByPrefix(prefix) {
        // get all data within prefix
        let results = [];
        let topLevelNames = this.#getChildren(Higher.CONTACTS).concat([this.getLinkedName()]);
        let intermediate = this.localStorageWrapper.getMany(this.#getDataPrefix(prefix));
        intermediate.forEach(({ key, value }) => {
            // deduplicates admins/writers/readers lists
            let admins = this.#listIntersect(topLevelNames, this.#getAdmins(value.groupID));
            let writers = this.#listIntersect(topLevelNames, this.#getWriters(value.groupID).filter((x) => !admins.includes(x)));
            let readers = this.#listIntersect(topLevelNames, this.#getChildren(value.groupID).filter((x) => !admins.includes(x) && !writers.includes(x)));
            results.push({
                id: key.split(Higher.SLASH)[2],
                data: value.data,
                admins: admins,
                writers: writers,
                readers: readers,
            });
        });
        return results;
    }
    getAllData() {
        let results = [];
        let appPrefixes = this.storagePrefixes.filter((x) => x != Higher.GROUP);
        appPrefixes.forEach((appPrefix) => {
            this.localStorageWrapper.getMany(this.#getDataPrefix(appPrefix)).forEach((dataObj) => {
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
    async removeData(prefix, id) {
        await this.#removeDataHelper(this.#getDataKey(prefix, id));
    }
    /*
     *****************
     * Group methods *
     *****************
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
    #createGroup(ID, name, contactLevel, parents, children, admins, writers) {
        this.#setGroup(ID, new Group(name, contactLevel, parents, children, admins, writers));
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
    #createKey(ID, name, contactLevel, parents, admins, writers) {
        this.#setGroup(ID, new Key(name, contactLevel, parents, admins, writers));
    }
    /**
     * Group getter.
     *
     * @param {string} groupID ID of group to get
     * @returns {Object}
     *
     * @private
     */
    #getGroup(groupID) {
        return this.localStorageWrapper.get(this.#getDataKey(Higher.GROUP, groupID));
    }
    /**
     * Gets all groups on current device.
     *
     * @returns {Object[]}
     *
     * @private
     */
    // FIXME getMany should maybe use "id" as the first field instead of "key"
    // (so it can return groupObjType[]) unless the key really is the full LS key
    #getAllGroups() {
        return this.localStorageWrapper.getMany(this.#getDataPrefix(Higher.GROUP));
    }
    /**
     * Recursively gets all children groups in the subtree with root groupID (result includes the root group).
     *
     * @param {string} groupID ID of group to get all subgroups of
     * @returns {Object[]}
     *
     * @private
     */
    #getAllSubgroups(groupIDs) {
        let groups = [];
        groupIDs.forEach((groupID) => {
            let group = this.#getGroup(groupID);
            if (group !== null) {
                groups.push({
                    id: groupID,
                    value: group,
                });
                if (group.children !== undefined) {
                    groups = groups.concat(this.#getAllSubgroups(group.children));
                }
            }
        });
        return groups;
    }
    /**
     * Group setter.
     *
     * @param {string} groupID ID of group to set
     * @param {Object} groupValue value to set group to
     *
     * @private
     */
    #setGroup(groupID, groupValue) {
        this.localStorageWrapper.set(this.#getDataKey(Higher.GROUP, groupID), groupValue);
    }
    /**
     * Group remover.
     *
     * @param {string} groupID ID of group to remove
     *
     * @private
     */
    #removeGroup(groupID) {
        this.localStorageWrapper.remove(this.#getDataKey(Higher.GROUP, groupID));
    }
    /**
     * Updates group with new value.
     *
     * @param {string} groupID group ID
     * @param {Object} value group value
     *
     * @private
     */
    async #updateGroupLocally({ groupID, groupValue }) {
        // cases that handle shared data where a subset of the members
        // do not already exist in this device's contacts list
        let contacts = this.getContacts();
        // if contactLevel = true but not in contacts, add
        if (groupValue.contactLevel && !contacts.includes(groupID)) {
            await this.#addChild(Higher.CONTACTS, groupID, [this.core.olmWrapper.getIdkey()]);
        }
        // if in contacts but contactLevel = false, make contactLevel = true
        if (!groupValue.contactLevel && contacts.includes(groupID)) {
            groupValue.contactLevel = true;
        }
        this.#setGroup(groupID, groupValue);
    }
    async #updateGroupRemotely(groupID, value, idkeys) {
        await this.core.sendMessage(idkeys, {
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
    async #updateGroup(groupID, value, idkeys) {
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
    #linkGroupsLocally({ parentID, childID }) {
        this.#addParentLocally({ groupID: childID, parentID: parentID });
        this.#addChildLocally({ groupID: parentID, childID: childID });
    }
    async #linkGroupsRemotely(parentID, childID, idkeys) {
        await this.core.sendMessage(idkeys, {
            msgType: Higher.LINK_GROUPS,
            parentID: parentID,
            childID: childID,
        });
    }
    async #linkGroups(parentID, childID, idkeys) {
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
    #deleteGroupLocally({ groupID }) {
        // unlink this group from parents
        this.#getParents(groupID).forEach((parentID) => {
            this.#removeChildLocally(parentID, groupID);
        });
        // unlink children from this group
        this.#getChildren(groupID).forEach((childID) => {
            this.#removeParentLocally({ groupID: childID, parentID: groupID });
            // garbage collect any KEY group that no longer has any parents
            if (this.#isKey(this.#getGroup(childID)) && this.#getParents(childID).length === 0) {
                this.#removeGroup(childID);
            }
        });
        // delete group
        this.#removeGroup(groupID);
        // TODO more GC e.g. when contact's childrens list is empty -> remove contact
        // TODO if group is a device, delete session associated with it
    }
    async #deleteGroupRemotely(groupID, idkeys) {
        await this.core.sendMessage(idkeys, {
            msgType: Higher.DELETE_GROUP,
            groupID: groupID,
        });
    }
    async #deleteGroup(groupID, idkeys) {
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
    async #unlinkAndDeleteGroup(groupID, parentID, idkeys) {
        // unlink parent
        await this.#removeParent(groupID, parentID, idkeys);
        // delete parent
        await this.#deleteGroup(parentID, idkeys);
    }
    /**
     * Gets childrens list of group with groupID.
     *
     * @param {string} groupID ID of group to get children of
     * @returns {string[]}
     *
     * @private
     */
    #getChildren(groupID) {
        return this.#getGroup(groupID)?.children ?? [];
    }
    /**
     * Gets parents list of group with groupID.
     *
     * @param {string} groupID ID of group whose parents list to get
     * @returns {string[]}
     *
     * @private
     */
    #getParents(groupID) {
        return this.#getGroup(groupID)?.parents ?? [];
    }
    /**
     * Get admins list of group.
     *
     * @param {string} groupID id of group whose admins list to get
     * @returns {string[]}
     *
     * @private
     */
    #getAdmins(groupID) {
        return this.#getGroup(groupID)?.admins ?? [];
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
    #getAdminsIntersection(groupIDs) {
        let adminSet;
        groupIDs.forEach((groupID) => {
            if (adminSet === undefined) {
                adminSet = this.#getAdmins(groupID);
            }
            else {
                adminSet = this.#listIntersect(adminSet, this.#getAdmins(groupID));
            }
        });
        return adminSet ?? [];
    }
    /**
     * Gets writers list of group.
     *
     * @param {string} groupID id of group to get writers list of
     * @returns {string[]}
     *
     * @private
     */
    #getWriters(groupID) {
        return this.#getGroup(groupID)?.writers ?? [];
    }
    #listRemoveCallback(ID, newList) {
        let idx = newList.indexOf(ID);
        if (idx !== -1)
            newList.splice(idx, 1);
        return newList;
    }
    #listAddCallback(ID, newList) {
        // deduplicate: only add ID if doesn't already exist in list
        if (newList.indexOf(ID) === -1)
            newList.push(ID);
        return newList;
    }
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
    #updateList(key, groupID, memberID, callback) {
        let oldGroupValue = this.#getGroup(groupID);
        let newList = callback(memberID, oldGroupValue[key]);
        let newGroupValue = { ...oldGroupValue, [key]: newList };
        this.#setGroup(groupID, newGroupValue);
        return newGroupValue;
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
    #addChildLocally({ groupID, childID }) {
        return this.#updateList(CHILDREN, groupID, childID, this.#listAddCallback);
    }
    async #addChildRemotely(groupID, childID, idkeys) {
        await this.core.sendMessage(idkeys, {
            msgType: Higher.ADD_CHILD,
            groupID: groupID,
            childID: childID,
        });
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
    async #addChild(groupID, childID, idkeys) {
        await this.#addChildRemotely(groupID, childID, idkeys);
        // TODO impl pending state
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
    #removeChildLocally(groupID, childID) {
        return this.#updateList(CHILDREN, groupID, childID, this.#listRemoveCallback);
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
    #addParentLocally({ groupID, parentID }) {
        return this.#updateList(PARENTS, groupID, parentID, this.#listAddCallback);
    }
    async #addParentRemotely(groupID, parentID, idkeys) {
        await this.core.sendMessage(idkeys, {
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
    async #addParent(groupID, parentID, idkeys) {
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
    #removeParentLocally({ groupID, parentID }) {
        return this.#updateList(PARENTS, groupID, parentID, this.#listRemoveCallback);
    }
    async #removeParentRemotely(groupID, parentID, idkeys) {
        await this.core.sendMessage(idkeys, {
            msgType: Higher.REMOVE_PARENT,
            groupID: groupID,
            parentID: parentID,
        });
    }
    async #removeParent(groupID, parentID, idkeys) {
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
    #addAdminInMem(oldGroupValue, adminID) {
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
    #addAdminLocally({ groupID, adminID }) {
        return this.#updateList(ADMINS, groupID, adminID, this.#listAddCallback);
    }
    async #addAdminRemotely(groupID, adminID, idkeys) {
        await this.core.sendMessage(idkeys, {
            msgType: Higher.ADD_ADMIN,
            groupID: groupID,
            adminID: adminID,
        });
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
    async #addAdmin(groupID, adminID, idkeys) {
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
    #removeAdminLocally({ groupID, adminID }) {
        return this.#updateList(ADMINS, groupID, adminID, this.#listRemoveCallback);
    }
    async #removeAdminRemotely(groupID, adminID, idkeys) {
        await this.core.sendMessage(idkeys, {
            msgType: Higher.REMOVE_ADMIN,
            groupID: groupID,
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
    async #removeAdmin(prefix, id, toUnshareGroupID) {
        let { curGroupID, errCode } = this.#unshareChecks(prefix, id, toUnshareGroupID);
        if (errCode === 0) {
            await this.#removeAdminRemotely(curGroupID, toUnshareGroupID, this.#resolveIDs([curGroupID]));
            // TODO impl pending state
        }
    }
    /**
     * Adds writer to writers list of a group (modifies group in place).
     *
     * @param {Object} oldGroupValue group value with admins list to update
     * @param {string} writerID id of writer to add
     *
     * @private
     */
    #addWriterLocally({ groupID, writerID }) {
        return this.#updateList(WRITERS, groupID, writerID, this.#listAddCallback);
    }
    async #addWriterRemotely(groupID, writerID, idkeys) {
        await this.core.sendMessage(idkeys, {
            msgType: Higher.ADD_WRITER,
            groupID: groupID,
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
    async #addWriter(groupID, writerID, idkeys) {
        await this.#addWriterRemotely(groupID, writerID, idkeys);
        // TODO impl pending state
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
    #removeWriterLocally({ groupID, writerID }) {
        return this.#updateList(WRITERS, groupID, writerID, this.#listRemoveCallback);
    }
    async #removeWriterRemotely(groupID, writerID, idkeys) {
        await this.core.sendMessage(idkeys, {
            msgType: Higher.REMOVE_WRITER,
            groupID: groupID,
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
    async #removeWriter(prefix, id, toUnshareGroupID) {
        let { curGroupID, errCode } = this.#unshareChecks(prefix, id, toUnshareGroupID);
        if (errCode === 0) {
            await this.#removeWriterRemotely(curGroupID, toUnshareGroupID, this.#resolveIDs([curGroupID]));
            // TODO impl pending state
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
    #groupReplaceHelper(key, fullGroup, IDToReplace, replacementID) {
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
    #groupContainsHelper(key, fullGroup, IDToCheck) {
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
    #groupReplace(group, IDToReplace, replacementID) {
        let updatedGroup = group;
        if (group.id === IDToReplace) {
            updatedGroup = {
                ...updatedGroup,
                id: replacementID,
            };
        }
        this.#groupReplaceHelper(PARENTS, updatedGroup, IDToReplace, replacementID);
        this.#groupReplaceHelper(CHILDREN, updatedGroup, IDToReplace, replacementID);
        this.#groupReplaceHelper(ADMINS, updatedGroup, IDToReplace, replacementID);
        this.#groupReplaceHelper(WRITERS, updatedGroup, IDToReplace, replacementID);
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
    #groupContains(group, IDToCheck) {
        if (group.id === IDToCheck) {
            return true;
        }
        let bool = false;
        bool ||= this.#groupContainsHelper(PARENTS, group, IDToCheck);
        bool ||= this.#groupContainsHelper(CHILDREN, group, IDToCheck);
        bool ||= this.#groupContainsHelper(ADMINS, group, IDToCheck);
        bool ||= this.#groupContainsHelper(WRITERS, group, IDToCheck);
        return bool;
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
    #listIntersect(list1, list2) {
        let intersection = [];
        list1.forEach((e) => {
            if (list2.includes(e))
                intersection.push(e);
        });
        return intersection;
    }
    /*
     *************************
     * Sharing and unsharing *
     *************************
     */
    /**
     * Randomly generates a new group ID.
     *
     * @returns {string}
     *
     * @private
     */
    #getNewGroupID() {
        return crypto.randomUUID();
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
    async #shareData(prefix, id, toShareGroupID) {
        let idkey = this.core.olmWrapper.getIdkey();
        let key = this.#getDataKey(prefix, id);
        let value = this.localStorageWrapper.get(key);
        let curGroupID = value?.groupID ?? null;
        let retval = {
            newGroupIdkeys: [],
            sharingGroupID: null,
        };
        // check that current device can modify this group
        if (!this.#hasAdminPriv(idkey, curGroupID)) {
            this.#printBadGroupPermissionsError();
            return { ...retval, errCode: -1 };
        }
        // check that toShareGroupID exists
        if (this.#getGroup(toShareGroupID) === null) {
            return { ...retval, errCode: -1 };
        }
        if (curGroupID !== null) {
            let sharingGroupID;
            let linkedName = this.getLinkedName();
            let newGroupIdkeys = this.#resolveIDs([curGroupID, toShareGroupID]);
            // if underlying group is linkedName, generate new group to encompass sharing
            if (curGroupID === linkedName) {
                sharingGroupID = this.#getNewGroupID();
                // create new sharing group
                let newGroupValue = new Group(null, false, [], [curGroupID, toShareGroupID], [curGroupID], [curGroupID]);
                await this.#updateGroup(sharingGroupID, newGroupValue, newGroupIdkeys);
                // add parent pointers for both previously-existing groups
                // note: have to separately add parents everywhere instead of just doing 
                // it once and sending updated group b/c groups on diff devices have diff
                // permissions/etc, don't want to override that
                await this.#addParent(curGroupID, sharingGroupID, newGroupIdkeys);
                await this.#addParent(toShareGroupID, sharingGroupID, newGroupIdkeys);
                // send actual data that group now points to
                await this.#setDataHelper(key, value.data, sharingGroupID);
            }
            else { // sharing group already exists for this data object, modify existing group
                sharingGroupID = curGroupID;
                // send existing sharing group subgroups to new member devices
                let sharingGroupSubgroups = this.#getAllSubgroups([sharingGroupID]);
                let newMemberIdkeys = this.#resolveIDs([toShareGroupID]);
                // FIXME send bulk updateGroup message
                for (let sharingGroupSubgroup of sharingGroupSubgroups) {
                    let newGroup = this.#groupReplace(sharingGroupSubgroup, Higher.LINKED, Higher.CONTACTS);
                    await this.#updateGroup(newGroup.id, newGroup.value, newMemberIdkeys);
                }
                // send new member subgroups to existing members
                let toShareSubgroups = this.#getAllSubgroups([toShareGroupID]);
                let existingMemberIdkeys = this.#resolveIDs([curGroupID]);
                // FIXME send bulk updateGroup message
                for (let toShareSubgroup of toShareSubgroups) {
                    let newGroup = this.#groupReplace(toShareSubgroup, Higher.LINKED, Higher.CONTACTS);
                    await this.#updateGroup(newGroup.id, newGroup.value, existingMemberIdkeys);
                }
                // add child to existing sharing group
                await this.#addChild(sharingGroupID, toShareGroupID, newGroupIdkeys);
                // add parent from new child to existing sharing group
                await this.#addParent(toShareGroupID, sharingGroupID, newGroupIdkeys);
                // send actual data that group now points to
                await this.#setDataHelper(key, value.data, sharingGroupID);
            }
            return {
                newGroupIdkeys: newGroupIdkeys,
                sharingGroupID: sharingGroupID,
                errCode: 0,
            };
        }
        return { ...retval, errCode: 0 };
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
    #unshareChecks(prefix, id, toUnshareGroupID) {
        let idkey = this.core.olmWrapper.getIdkey();
        let key = this.#getDataKey(prefix, id);
        let value = this.localStorageWrapper.get(key);
        let curGroupID = value?.groupID ?? null;
        let retval = {
            key: key,
            value: value,
            curGroupID: curGroupID,
        };
        // check that current device can modify group
        if (!this.#hasAdminPriv(idkey, curGroupID)) {
            this.#printBadGroupPermissionsError();
            return { ...retval, errCode: -1 };
        }
        // check that group exists
        if (this.#getGroup(toUnshareGroupID) === null) {
            return { ...retval, errCode: -1 };
        }
        // check that data is currently shared with that group
        if (!this.#isMember(toUnshareGroupID, [curGroupID])) {
            return { ...retval, errCode: -1 };
        }
        // prevent device from unsharing with self 
        // TODO when would it make sense to allow this?
        if (this.#isMember(toUnshareGroupID, [this.getLinkedName()])) {
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
    async #unshareData(prefix, id, toUnshareGroupID) {
        let { key, value, curGroupID, errCode } = this.#unshareChecks(prefix, id, toUnshareGroupID);
        if (errCode === 0 && curGroupID !== null) {
            // delete data from toUnshareGroupID devices before deleting related group
            await this.#removeDataHelper(key, curGroupID, toUnshareGroupID);
            // unlink and delete curGroupID group on toUnshareGroupID devices
            // OK to just remove toUnshareGroupID from group b/c unique group per
            // object => don't need to worry about breaking the sharing of other 
            // objects TODO unless eventually (for space efficiency) use one group
            // for multiple objects
            await this.#unlinkAndDeleteGroup(toUnshareGroupID, curGroupID, this.#resolveIDs([toUnshareGroupID]));
            // FIXME assuming simple structure, won't work if toUnshareGroupID is
            // further than the first level down
            let newChildren = this.#getChildren(curGroupID).filter((x) => x != toUnshareGroupID);
            // use newChildren[0] (existing group) as the new group name
            // (e.g. when an object is shared with one contact and then unshared with 
            // that same contact, newChildren[0] is expected to be the linkedName of the
            // sharing device(s))
            if (newChildren.length === 1) {
                let sharingIdkeys = this.#resolveIDs([newChildren[0]]);
                // unlink and delete curGroupID group on new group's devices
                await this.#unlinkAndDeleteGroup(newChildren[0], curGroupID, sharingIdkeys);
                // update data with new group ID on new group's devices
                await this.#setDataHelper(key, value.data, newChildren[0]);
            }
            else {
                let sharingGroupID = this.#getNewGroupID();
                // create new group using curGroupID's admins and writers list (removing
                // any instances of toUnshareGroupID _on the immediate next level_
                // TODO check as far down as possible
                let oldGroup = this.#getGroup(curGroupID);
                let newGroup = new Group(null, false, [], newChildren, oldGroup.admins.filter((x) => x != toUnshareGroupID), oldGroup.writers.filter((x) => x != toUnshareGroupID));
                // delete old group and relink parent points from old group to new group
                // for all remaining (top-level) children of the new group
                for (let newChild of newChildren) {
                    let childIdkeys = this.#resolveIDs([newChild]);
                    await this.#updateGroup(sharingGroupID, newGroup, childIdkeys);
                    await this.#unlinkAndDeleteGroup(sharingGroupID, curGroupID, childIdkeys);
                    await this.#addParent(newChild, sharingGroupID, childIdkeys);
                }
                // update data with new group ID on sharingGroupID devices
                await this.#setDataHelper(key, value.data, sharingGroupID);
            }
        }
    }
    // demultiplexing map from message types to functions
    demuxMap = {
        [Higher.REQ_UPDATE_LINKED]: this.#processUpdateLinkedRequest,
        [Higher.CONFIRM_UPDATE_LINKED]: this.#processConfirmUpdateLinked,
        [Higher.REQ_CONTACT]: this.#processContactRequest,
        [Higher.CONFIRM_CONTACT]: this.#processConfirmContact,
        [Higher.LINK_GROUPS]: this.#linkGroupsLocally,
        [Higher.ADD_PARENT]: this.#addParentLocally,
        [Higher.ADD_CHILD]: this.#addChildLocally,
        [Higher.ADD_WRITER]: this.#addWriterLocally,
        [Higher.ADD_ADMIN]: this.#addAdminLocally,
        [Higher.REMOVE_PARENT]: this.#removeParentLocally,
        [Higher.REMOVE_WRITER]: this.#removeWriterLocally,
        [Higher.REMOVE_ADMIN]: this.#removeAdminLocally,
        [Higher.UPDATE_GROUP]: this.#updateGroupLocally,
        [Higher.UPDATE_DATA]: this.#updateDataLocally,
        [Higher.DELETE_DEVICE]: this.#deleteDeviceLocally,
        [Higher.DELETE_GROUP]: this.#deleteGroupLocally,
        [Higher.DELETE_DATA]: this.#deleteDataLocally,
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
    #checkPermissions(payload, srcIdkey) {
        let permissionsOK = false;
        // no reader checks, any device that gets data should correctly be a reader
        switch (payload.msgType) {
            /* special checks */
            case Higher.CONFIRM_UPDATE_LINKED: {
                if (this.#getOutstandingLinkIdkey() === srcIdkey) {
                    permissionsOK = true;
                }
                break;
                /* admin checks */
            }
            case Higher.LINK_GROUPS: {
                if (this.#hasAdminPriv(srcIdkey, payload.parentID) && this.#hasAdminPriv(srcIdkey, payload.childID)) {
                    permissionsOK = true;
                }
                break;
            }
            case Higher.DELETE_DEVICE: {
                if (this.#hasAdminPriv(srcIdkey, this.core.olmWrapper.getIdkey())) {
                    permissionsOK = true;
                }
                break;
            }
            case Higher.UPDATE_GROUP: {
                // TODO what was this case for again? need to somehow check that
                // can modify all parent groups of a group? but wouldn't that be
                // more like ADD_CHILD?
                if (this.#hasAdminPriv(srcIdkey, payload.groupValue.parents, true)) {
                    permissionsOK = true;
                }
                // check that group being created is being created by a device
                // with admin privs
                if (this.#hasAdminPriv(srcIdkey, payload.groupValue.admins, false)) {
                    permissionsOK = true;
                }
                break;
            }
            case Higher.ADD_PARENT:
            case Higher.REMOVE_PARENT: {
                // ok to add parent (e.g. send this group data)
                // not ok to add child (e.g. have this group send data to me)
                if (this.#hasAdminPriv(srcIdkey, payload.parentID)) {
                    permissionsOK = true;
                }
                break;
            }
            case Higher.ADD_CHILD:
            case Higher.ADD_WRITER:
            case Higher.REMOVE_WRITER:
            case Higher.ADD_ADMIN:
            case Higher.REMOVE_ADMIN: {
                if (this.#hasAdminPriv(srcIdkey, payload.groupID)) {
                    permissionsOK = true;
                }
                break;
            }
            case Higher.DELETE_GROUP: {
                if (this.#getGroup(payload.groupID) === null || this.#hasAdminPriv(srcIdkey, payload.groupID) || this.#getOutstandingLinkIdkey() === srcIdkey) {
                    permissionsOK = true;
                }
                break;
                /* writer checks */
            }
            case Higher.UPDATE_DATA: {
                if (this.#hasWriterPriv(srcIdkey, payload.dataValue.groupID)) {
                    permissionsOK = true;
                }
                break;
            }
            case Higher.DELETE_DATA: {
                if (this.#hasWriterPriv(srcIdkey, this.localStorageWrapper.get(payload.key)?.groupID)) {
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
        this.demuxFunc = this.demuxMap[payload.msgType];
        return permissionsOK;
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
    #hasAdminPriv(toCheckID, groupIDs, inDB = null) {
        if (typeof groupIDs === "string") { // groupIDs is a single value
            return this.#isMember(toCheckID, this.#getAdmins(groupIDs));
        }
        else if (inDB) { // inDB == true
            return this.#isMember(toCheckID, this.#getAdminsIntersection(groupIDs));
        }
        else { // inDB == false
            return this.#isMember(toCheckID, groupIDs);
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
    #hasWriterPriv(toCheckID, groupID) {
        return this.#isMember(toCheckID, this.#getWriters(groupID));
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
    #isMember(toCheckGroupID, groupIDList) {
        let isMemberRetval = false;
        groupIDList.forEach((groupID) => {
            if (groupID === toCheckGroupID) {
                isMemberRetval ||= true;
                return;
            }
            isMemberRetval ||= this.#isMember(toCheckGroupID, this.#getChildren(groupID));
        });
        return isMemberRetval;
    }
    /**
     * Allow application to share particular data object with another set of devices
     * with read privileges.
     *
     * @param {string} prefix app prefix for this data object
     * @param {string} id data object id
     * @param {string} toShareGroupID group to grant read privileges to
     */
    async grantReaderPrivs(prefix, id, toShareGroupID) {
        await this.#shareData(prefix, id, toShareGroupID);
    }
    /**
     * Allow application to share particular data object with another set of devices
     * with read/write privileges.
     *
     * @param {string} prefix app prefix for this data object
     * @param {string} id data object id
     * @param {string} toShareGroupID group to grant read/write privileges to
     */
    async grantWriterPrivs(prefix, id, toShareGroupID) {
        let { newGroupIdkeys, sharingGroupID, errCode } = await this.#shareData(prefix, id, toShareGroupID);
        if (errCode === 0 && sharingGroupID !== null) {
            // add writer
            await this.#addWriter(sharingGroupID, toShareGroupID, newGroupIdkeys);
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
    async grantAdminPrivs(prefix, id, toShareGroupID) {
        let { newGroupIdkeys, sharingGroupID, errCode } = await this.#shareData(prefix, id, toShareGroupID);
        if (errCode === 0 && sharingGroupID !== null) {
            // add writer
            await this.#addWriter(sharingGroupID, toShareGroupID, newGroupIdkeys);
            // add admin
            await this.#addAdmin(sharingGroupID, toShareGroupID, newGroupIdkeys);
        }
    }
    /**
     * Remove member from the relevant group's writers list.
     *
     * @param {string} prefix app-specific data prefix
     * @param {string} id data object id
     * @param {string} toUnshareGroupID id of member to revoke write privileges of
     */
    async revokeWriterPrivs(prefix, id, toUnshareGroupID) {
        await this.#removeWriter(prefix, id, toUnshareGroupID);
    }
    /**
     * Remove member from the relevant group's admins list.
     *
     * @param {string} prefix app-specific data prefix
     * @param {string} id data object id
     * @param {string} toUnshareGroupID id of member to revoke admin privileges of
     */
    async revokeAdminPrivs(prefix, id, toUnshareGroupID) {
        await this.#removeAdmin(prefix, id, toUnshareGroupID);
    }
    /**
     * Remove member from all of the relevant group's lists.
     *
     * @param {string} prefix app-specific data prefix
     * @param {string} id data object id
     * @param {string} toUnshareGroupID id of member to revoke privileges of
     */
    async revokeAllPrivs(prefix, id, toUnshareGroupID) {
        await this.#unshareData(prefix, id, toUnshareGroupID);
    }
}
