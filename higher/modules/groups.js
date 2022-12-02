/*
 **************
 **************
 *** Groups ***
 **************
 **************
 */
import { LocalStorageWrapper } from "../db/localStorageWrapper.js";
/* doubly-linked tree, allows cycles */
const NAME = "name";
const CONTACT_LEVEL = "contactLevel";
const PARENTS = "parents";
const CHILDREN = "children";
export class Group {
    id;
    name;
    contactLevel;
    parents;
    children;
    constructor(id, name, contactLevel, parents, children) {
        this.id = id;
        this.name = name;
        this.contactLevel = contactLevel;
        this.parents = parents;
        this.children = children;
    }
}
export class Groups {
    static #PREFIX = "__group";
    static #storageWrapper = new LocalStorageWrapper();
    /**
     * Allow groups to work on multiple storage types
     * @param storage
     */
    constructor() { }
    //FIX: overloading of the term
    static #getKey(group) {
        return Groups.#PREFIX + "/" + group + "/";
    }
    /**
     * Group getter.
     *
     * @param {string} groupID ID of group to get
     * @returns {Object}
     *
     */
    static #getGroup(groupID) {
        return this.#storageWrapper.get(this.#getKey(groupID));
    }
    /**
     * Group setter.
     *
     * @param {string} groupID ID of group to set
     * @param {Object} groupValue value to set group to
     *
     * @private
     */
    static #setGroup(groupID, groupValue) {
        this.#storageWrapper.set(this.#getKey(groupID), groupValue);
    }
    /**
    * Helper function for determining if resolveIDs has hit it's base case or not.
    *
    * @param {Object} group a group
    * @returns {boolean}
    *
    * @private
    */
    static #isDevice(group) {
        if (group.children) {
            return false;
        }
        return true;
    }
    /**
     * Create new group from list of ids
     * @param {string[]} ids group Ids to include in group
     * @return {string} group id of the newly created group
     */
    static newDevice(deviceId, name, parent) {
        let newGroup = new Group(deviceId, name, false, null, [parent]);
        this.#setGroup(deviceId, newGroup);
        return deviceId;
    }
    /**
     * Delete group from list of ids
     * @param {string[]} ids group Ids to include in group
     * @return {string} group id of the newly created group
     */
    static deleteDevice(deviceId) {
        let delDevice = this.#getGroup(deviceId);
        for (let p in delDevice.parents) {
            let parentGroup = this.#getGroup(p);
            let newChildren = [];
            for (let c in parentGroup.children) {
                if (c != deviceId) {
                    newChildren.push(c);
                }
            }
            parentGroup.children = newChildren;
            this.#setGroup(p, parentGroup);
        }
        return deviceId;
    }
    /**
     * Randomly generates a new group ID.
     *
     * @returns {string}
     *
     * @private
     */
    static #generateNewGroupId() {
        return crypto.randomUUID();
    }
    /**
     * Create new group from list of ids
     * @param {string[]} ids group Ids to include in group
     * @return {string} group id of the newly created group
     */
    static newGroup(name, contactLevel, ids) {
        let newGroupId = this.#generateNewGroupId();
        let newGroup = new Group(newGroupId, name, contactLevel, null, ids);
        for (let id in ids) {
            let child = this.#getGroup(id);
            child.parents.push(newGroupId);
        }
        this.#setGroup(newGroupId, newGroup);
        return newGroupId;
    }
    /**
     * Add groups in the ids list to the group
     * @param {string} group id of group to add ids to
     * @param {string[]}  ids list of ideas to add to group
     * @returns {string} group id
     */
    static addToGroup(groupId, ids) {
        let group = this.#getGroup(groupId);
        for (let id in ids) {
            group.children?.push(id);
            let child = this.#getGroup(id);
            child.parents.push(groupId);
        }
        this.#setGroup(groupId, group);
        return groupId;
    }
    /**
     * Remove groups in the ids list to the group
     * @param {string} group id of group to add ids to
     * @param {string[]}  ids list of ideas to add to group
     * @returns {string} group id
     */
    static removeFromGroup(groupId, removeId) {
        let group = this.#getGroup(groupId);
        let newChildren = [];
        for (let c in group.children) {
            if (removeId != c) {
                newChildren.push(c);
            }
        }
        let removedGroup = this.#getGroup(removeId);
        let newParents = [];
        for (let p in removedGroup.parents) {
            if (p != groupId) {
                newParents.push(p);
            }
        }
        removedGroup.parents = newParents;
        this.#setGroup(groupId, group);
        this.#setGroup(removeId, removedGroup);
        return groupId;
    }
    /**
     * Group remover.
     *
     * @param {string} groupID ID of group to remove
     *
     * @private
     */
    static removeGroup(groupID) {
        this.#storageWrapper.remove(this.#getKey(groupID));
        let removedGroup = this.#getGroup(groupID);
        for (let p in removedGroup.parents) {
            let parentGroup = this.#getGroup(p);
            let newChildren = [];
            for (let c in parentGroup.children) {
                if (c != groupID) {
                    newChildren.push(c);
                }
            }
            parentGroup.children = newChildren;
            this.#setGroup(p, parentGroup);
        }
    }
    static getDevices(group) {
        if (typeof group === 'string') {
            return this.#resolveIDs([group]);
        }
        else {
            return this.#resolveIDs(group);
        }
    }
    /**
     * Resolves a list of one or more group IDs to a list of public keys.
     *
     * @param {string[]} ids group IDs to resolve
     * @return {string[]}
     *
     */
    static #resolveIDs(ids) {
        let idkeys = [];
        ids.forEach((id) => {
            let group = this.#getGroup(id);
            if (group !== null) {
                if (this.#isDevice(group)) { //FIX: change to check if it has children
                    idkeys.push(id);
                }
                else {
                    idkeys = idkeys.concat(this.#resolveIDs(group.children));
                }
            }
        });
        return idkeys;
    }
}
