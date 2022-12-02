import { Groups } from "./groups";
import { LocalStorageWrapper } from "../db/localStorageWrapper.js";

/**
 * EXPLAIN: has to be ONE GROUP per permission field
 *  or else you can have multiple writers that do not
 *  know about each other, etc... 
 *  or else have to introduce more logic here
 *  but readers don't necessarily have to know about
 *  all other readers
 *  */ 
export type permissionField = {
    admin: string,
    write: string,
    read: string,
}

export class Permissions {

    #linkedGroupId: string = "";
    #storageWrapper = new LocalStorageWrapper();


    constructor(linkedGroup, storage) {
        this.#linkedGroupId = linkedGroup;
        this.#storageWrapper = storage;

        //TODO: support not just admin, write, read privileges
        //can be developer defined 
    }

    #getPermissions(objectKey): permissionField {
        return this.#storageWrapper.get(objectKey).perms;
    }

    #setPermissions(objectKey, permissionField) {
        let object = this.#storageWrapper.get(objectKey);
        object.perms = permissionField;
        this.#storageWrapper.set(objectKey, object)
    }

    // TODO: combine setGroup functions into one
    // like setGroup(permField, groupId)

    /**
     * Assigns GroupId to readers in permissions
     * @param objectKey 
     * @param groupId 
     */

    setReadGroup(objectKey, groupId) {
        let perms = this.#getPermissions(objectKey);

        let newPerms : permissionField = {
            admin: perms.admin,
            write: perms.write,
            read: groupId,
        };     

        this.#setPermissions(objectKey, newPerms);

    }

    /**
     * Assigns GroupId to readers in permissions
     * @param objectKey 
     * @param groupId 
     */

    setWriteGroup(objectKey, groupId) {
        let perms = this.#getPermissions(objectKey);

        let newPerms : permissionField = {
            admin: perms.admin,
            write: groupId,
            read: perms.read,
        };     

        this.#setPermissions(objectKey, newPerms);
    }

    /**
     * Assigns GroupId to readers in permissions
     * @param objectKey 
     * @param groupId 
     */

    setAdminGroup(objectKey, groupId) {
        let perms = this.#getPermissions(objectKey);

        let newPerms : permissionField = {
            admin: groupId,
            write: perms.write,
            read: perms.read,
        };     

        this.#setPermissions(objectKey, newPerms);
    }
    
    setPermissionField(objectKey, adminGroupId, writeGroupId, readGroupId) {

        let newPerms : permissionField = {
            admin: adminGroupId,
            write: writeGroupId,
            read: readGroupId
        };     

        this.#setPermissions(objectKey, newPerms);
    }

    copyPermissions(toShareKey, toCopyKey) {
        let perms = this.#getPermissions(toCopyKey);
        this.#setPermissions(toShareKey, perms);

    }

    // TODO: combine following two into just hasPerms(permType, deviceId)
    hasWritePermissions(objectKey, deviceId): boolean {
        let perms = this.#getPermissions(objectKey);
        if (Groups.getDevices(perms.write).includes(deviceId)){
            return true
        } 
        return false;
    }

    hasAdminPermissions(objectKey, deviceId) {
        let perms = this.#getPermissions(objectKey);
        if (Groups.getDevices(perms.admin).includes(deviceId)){
            return true
        } 
        return false;
    }

}