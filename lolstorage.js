/*
  LOLSTORAGE: REALLY SIMPLE DECENTRALIZED SYNDICATION
  ----------------------------------------------------------------------
*/

var lol = (function() {

    var PREFIX = "lol";
    
    /** Creates a new localStorage content store with the given ID.
        IDs allow the use of independent "storage areas" in the
        browser's single localStorage namespace.  The ID should not
        contain special characters. */
    function LocalStore(id) {
        this.id = id;
    }

    LocalStore.prototype.toString = function() {
        return "[Local store " + this.id + "]";
    }

    LocalStore.prototype.localStorageKey = function(key) {
        return PREFIX + "-" + this.id + "-" + key;
    }

    LocalStore.prototype.get = function(key, cb) {
        var store = this;
        function doit() {
            try {
                var value = window.localStorage.getItem(store.localStorageKey(key));
                cb(true, value);
            } catch(err) {
                cb(false, err);
            }
        }
        setTimeout(doit, 1);
    }
    
    LocalStore.prototype.put = function(key, value, cb) {
        var store = this;
        function doit() {
            try {
                window.localStorage.setItem(store.localStorageKey(key), value);
                cb(true, "Put object " + key + " in " + store);
            } catch(err) {
                cb(false, err);
            }
        }
        setTimeout(doit, 1);
    }

    /* RemoteStorage store. */
    function RemoteStore(label, client) {
        this.label = label;
        this.client = client;
    }

    RemoteStore.prototype.toString = function() {
        return "[Remote store " + this.label + "]";
    }

    RemoteStore.prototype.get = function(key, cb) {
        this.client.get(key, function(error, data) {
            if (error) {
                cb(false, error);
            } else {
                cb(true, data);
            }
        });
    };
    
    RemoteStore.prototype.put = function(key, value, cb) {
        this.client.put(key, value, function(error) {
            if (error) {
                cb(false, error);
            } else {
                cb(true);
            }
        });
    };

    // Version control objects

    var BLOB_TYPE = "blob";
    var TREE_TYPE = "tree";
    var TREE_ENTRY_TYPE = "tree-entry";
    var COMMIT_TYPE = "commit";

    function Blob(data) {
        this.lol_type = BLOB_TYPE;
        this.lol_data = data;
    }

    function Tree(entries) {
        this.lol_type = TREE_TYPE;
        this.lol_entries = entries;
    }

    function TreeEntry(name, hash) {
        this.lol_type = TREE_ENTRY_TYPE;
        this.lol_name = name;
        this.lol_hash = hash;
    }

    function Commit(parents, message, root) {
        this.lol_type = COMMIT_TYPE;
        this.lol_parents = parents;
        this.lol_message = message;
        this.lol_root = root;
    }

    /** Returns the hash of the object - what gets used as the key in
        the content store.  Currently, this uses SHA1, but it can
        later be updated to other hash algorithms by our clever use of
        a prefix. */
    function hash(object) {
        return "sha1-" + Crypto.SHA1(content(object));
    }

    /** Returns the content of the object - what gets stored as the
        value in the content store.  For readability, we're indenting
        the JSON with a tab.

        Oh, and JavaScript wieners may say that this should be a
        method of the individual objects.  To which we agree in
        general, but are too lazy to implement in particular. */
    function content(object) {
        return JSON.stringify(object, undefined, "\t");
    }

    function parse(text) {
        return JSON.parse(text, function(key, value) {
            if (key === "lol_type") {
                this.__proto__ = objectPrototype(value);
            }
            return value;
        });
    }

    function objectPrototype(typeString) {
        switch(typeString) {
        case BLOB_TYPE: return Blob.prototype;
        case TREE_TYPE: return Tree.prototype;
        case TREE_ENTRY_TYPE: return TreeEntry.prototype;
        case COMMIT_TYPE: return Commit.prototype;
        default: throw("Unknown type string: " + typeString);
        }
    }

    /** Pulls a remote object by hash from a remote store to a local
        store. */
    function pull(hash, remoteStore, localStore, cb) {
        // Remote object already in store locally?
        localStore.get(hash,
                       task("Check if " + hash + " in " + localStore, function(ok, res) {
                           if (res != null) {
                               cb(true, "Hit " + hash + " in " + localStore);
                           } else {
                               // Fetch remote object and perform its custom pull logic.
                               remoteStore.get(hash,
                                               task("Get object " + hash + " from " + remoteStore,
                                                       function(ok, res) {
                                                           if (ok) {
                                                               if (res != null) {
                                                                   var remote = parse(res);
                                                                   remote.pull(remoteStore, localStore, cb);
                                                               } else {
                                                                   cb(false, "Not found " + hash + 
                                                                      " in " + remoteStore);
                                                               }
                                                           } else {
                                                               cb(false, res);
                                                           }
                                                       }));
                               
                           }
                       }));
    }

    Blob.prototype.pull = function(remoteStore, localStore, cb) {
        localStore.put(hash(this), content(this), cb);
    };

    Tree.prototype.pull = function(remoteStore, localStore, cb) {
        var that = this;
        var treeCB = task("Pull tree " + hash(this) + " from " + remoteStore + " to " + localStore, function (ok) {
            if (ok) {
                localStore.put(hash(that), content(that), cb);
            } else {
                cb(false, "Cannot pull tree: " + content(that));
            }
        });
        var entryCount = this.lol_entries.length;
        if (entryCount > 0) {
            var multiCB = multiCallback(entryCount, treeCB);
            for (var i = 0; i < entryCount; i++) {
                var entry = this.lol_entries[i];
                entry.pull(remoteStore, localStore, multiCB);
            }
        } else {
            treeCB(ok);
        }
    };

    TreeEntry.prototype.pull = function(remoteStore, localStore, cb) {
        pull(this.lol_hash, remoteStore, localStore, cb);
    };

    Commit.prototype.pull = function(remoteStore, localStore, cb) {
        cb(false, "Commit pulling not yet implemented.");
    };

    /** Returns a callback function that OKs the given callback after
        it has been called count times. */
    function multiCallback(count, cb) {
        if (count <= 0)
            throw("Count must be greater than zero.");
        var called = 0;
        var multiCB = function(ok, res) {
            if (ok) {
                called++;
                if (called === count) {
                    cb(ok);
                }
            } else {
                cb(false, res);
            }
        };
        return multiCB;
    }

    function task(label, cb) {
        var taskObject = { label: label, callback: cb, done: false };
        console.log(label);
        console.log(taskObject);
        function wrapperCB(ok, res) {
            taskObject.done = true;
            taskObject.ok = ok;
            taskObject.res = res;
            console.log("[done] " + label);
            console.log(taskObject);
            cb(ok, res);
        }
        return wrapperCB;
    }

    /*
      EXPORTS
      ------------------------------------------------------------------
    */

    return {
        "Blob": Blob,
        "Commit": Commit,
        "LocalStore": LocalStore,
        "RemoteStore": RemoteStore,
        "Tree": Tree,
        "TreeEntry": TreeEntry,
        "content": content,
        "hash": hash,
        "parse": parse,
        "pull": pull,
    };

}());
