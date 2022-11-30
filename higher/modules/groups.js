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
class Key {
    name;
    contactLevel;
    parents;
    constructor(name, contactLevel, parents, admins, writers) {
        this.name = name;
        this.contactLevel = contactLevel;
        this.parents = parents;
    }
}
class Group {
    name;
    contactLevel;
    parents;
    children;
    constructor(name, contactLevel, parents, children) {
        this.name = name;
        this.contactLevel = contactLevel;
        this.parents = parents;
        this.children = children;
    }
}
export class Groups {
    static #PREFIX = "__group";
    #storageWrapper = LocalStorageWrapper;
    /**
     * Allow groups to work on multiple storage types
     * @param storage
     */
    constructor(storage) {
        // this.#storageWrapper = storage;
    }
    #getKey(group) {
        return Groups.#PREFIX + "/" + group + "/";
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
    /**
     * Create new group from list of ids
     * @param {string[]} ids group Ids to include in group
     * @return {string} group id of the newly created group
     */
    newGroup(ids) {
        return "hi";
    }
    /**
     * Add groups in the ids list to the group
     * @param {string} group id of group to add ids to
     * @param {string[]}  ids list of ideas to add to group
     * @returns {string} group id
     */
    addToGroup(group, ids) {
        return "hi";
    }
    /**
     * Group getter.
     *
     * @param {string} groupID ID of group to get
     * @returns {Object}
     *
     * @private
     */
    getGroup(groupID) {
        return this.#storageWrapper.get(this.#getKey(groupID));
    }
    /**
     * Resolves a list of one or more group IDs to a list of public keys.
     *
     * @param {string[]} ids group IDs to resolve
     * @return {string[]}
     *
     */
    resolveIDs(ids) {
        let idkeys = [];
        ids.forEach((id) => {
            let group = this.getGroup(id);
            if (group !== null) {
                if (this.#isKey(group)) {
                    idkeys.push(id);
                }
                else {
                    idkeys = idkeys.concat(this.resolveIDs(group.children));
                }
            }
        });
        return idkeys;
    }
}
