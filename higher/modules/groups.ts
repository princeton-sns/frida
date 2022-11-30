/*
 **************
 **************
 *** Groups ***
 **************
 **************
 */


import { LocalStorageWrapper } from "../db/localStorageWrapper.js";

/* doubly-linked tree, allows cycles */
const NAME: string = "name";
const CONTACT_LEVEL: string = "contactLevel";
const PARENTS: string = "parents";
const CHILDREN: string = "children";

type groupObjType = {
    id: string,
    value: groupValType,
};

type groupValType = {
    name: string,
    contactLevel: boolean,
    parents: string[],
    children?: string[],
};

class Key {
    name: string;
    contactLevel: boolean;
    parents: string[];

    constructor(name, contactLevel, parents, admins, writers) {
        this.name = name;
        this.contactLevel = contactLevel;
        this.parents = parents;
    }
}

class Group {
    name: string;
    contactLevel: boolean;
    parents: string[];
    children: string[];

    constructor(name, contactLevel, parents, children) {
        this.name = name;
        this.contactLevel = contactLevel;
        this.parents = parents;
        this.children = children;
    }
}

type storageObjType = {
    key: string,
    value: any // FIXME groupObjType | dataObjType
};

export class Groups {

    static #PREFIX  : string = "__group";
    #storageWrapper = LocalStorageWrapper;

    /**
     * Allow groups to work on multiple storage types
     * @param storage 
     */
    private constructor(storage) {
        // this.#storageWrapper = storage;
    }

    #getKey(group: string): string {
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
    #isKey(group: groupValType): boolean {
        if (group.children) {
            return false;
        }
        return true;
    }

    /**
     * Randomly generates a new group ID.
     *
     * @returns {string}
     *
     * @private
     */
    #getNewGroupID(): string {
        return crypto.randomUUID();
    }

    /**
     * Create new group from list of ids 
     * @param {string[]} ids group Ids to include in group 
     * @return {string} group id of the newly created group
     */
    newGroup(name: string, contactLevel: boolean, ids: string[]): string {
        let newGroupId = this.#getNewGroupID();
        let newGroup = new Group (
            name,
            contactLevel,
            null,
            ids,
        )

        this.#setGroup(newGroupId, newGroup);

        // TODO: iterate over children and make sure to link this group as parent
        return newGroupId;
    }

    /**
     * Add groups in the ids list to the group
     * @param {string} group id of group to add ids to
     * @param {string[]}  ids list of ideas to add to group
     * @returns {string} group id
     */
    addToGroup(group: string, ids: string[]): string {
        // TODO: write
        return "hi"
    }

    /**
     * Group getter.
     *
     * @param {string} groupID ID of group to get
     * @returns {Object}
     *
     * @private
     */
    getGroup(groupID: string): groupValType {
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
    
    setGroup(groupID: string, groupValue: groupValType) {
        this.#storageWrapper.set(this.#getKey(groupID), groupValue);
    }
    
    /**
     * Group remover.
     *
     * @param {string} groupID ID of group to remove
     *
     * @private
     */
    removeGroup(groupID: string) {
        this.#storageWrapper.remove(this.#getKey(groupID));
    }

    getDevices(groupId: string) : string[] {
        return this.#resolveIDs([groupId]);
    }
    /**
     * Resolves a list of one or more group IDs to a list of public keys.
     *
     * @param {string[]} ids group IDs to resolve
     * @return {string[]}
     *
     */
    #resolveIDs(ids: string[]): string[] {
        let idkeys = [];
        ids.forEach((id) => {
            let group = this.getGroup(id);
            if (group !== null) {
                if (this.#isKey(group)) {
                    idkeys.push(id);
                } else {
                    idkeys = idkeys.concat(this.#resolveIDs(group.children));
                }
            }
        });
        return idkeys;
    }
}