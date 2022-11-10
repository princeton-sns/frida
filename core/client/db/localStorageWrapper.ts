/*
 ******
 * DB *
 ******
 */

export class LocalStorageWrapper {
  constructor() {}

  set(key: string, value: any) {
    localStorage.setItem(
      key,
      JSON.stringify(value)
    );
  }

  get(key: string): any {
    return JSON.parse(localStorage.getItem(key));
  }

  getMany(keyPrefix: string): { key: string, value: any }[] {
    let results: { key: string, value: any }[] = [];
    for (let i: number = 0; i < localStorage.length; i++) {
      let key: string = localStorage.key(i);
      if (key.startsWith(keyPrefix)) {
        results.push({
          key: key,
          value: this.get(key),
        });
      }
    }
    return results;
  }

  remove(key: string) {
    localStorage.removeItem(key);
  }
  
  clear() {
    localStorage.clear();
  }
}

