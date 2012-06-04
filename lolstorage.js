/*
  LOLSTORAGE: REALLY SIMPLE DECENTRALIZED SYNDICATION
  ----------------------------------------------------------------------
*/

var lol = (function() {

    var PREFIX = "lol";
    
    function storageKey(key, storeID) {
        return PREFIX + "_" + storeID + "_" + key;
    }

    /** Creates a new localStorage content store with the given ID.
        IDs allow the use of independent "storage areas" in the
        browser's single localStorage namespace.  The ID should not
        contain special characters. */
    function LocalStore(id) {
        this.id = id;
    }

    LocalStore.prototype.toString = function() {
        return "[Local store " + this.id + "]";
    };

    LocalStore.prototype.get = function(key, cb) {
        var store = this;
        function doit() {
            try {
                var value = window.localStorage.getItem(storageKey(key, store.id));
                console.log("Get " + key +  " from " + store);
                cb(true, (value !== null) ? value : undefined);
            } catch(err) {
                cb(false, err);
            }
        }
        setTimeout(doit, 1);
    };
    
    LocalStore.prototype.put = function(key, value, cb) {
        var store = this;
        function doit() {
            try {
                window.localStorage.setItem(storageKey(key, store.id), value);
                console.log("Put " + key +  " to " + store);
                cb(true);
            } catch(err) {
                cb(false, err);
            }
        }
        setTimeout(doit, 1);
    };

    /* RemoteStorage store. */
    function RemoteStore(id, client) {
        this.id = id;
        this.client = client;
    }

    RemoteStore.prototype.toString = function() {
        return "[Remote store " + this.id + "]";
    };

    RemoteStore.prototype.get = function(key, cb) {
        this.client.get(storageKey(key, this.id), function(error, data) {
            if (error) {
                cb(false, error);
            } else {
                cb(true, data);
            }
        });
    };
    
    RemoteStore.prototype.put = function(key, value, cb) {
        this.client.put(storageKey(key, this.id), value, function(error) {
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

    function Blob(data) {
        this.lol_type = BLOB_TYPE;
        this.lol_data = data;
    }

    function Tree(entries) {
        this.lol_type = TREE_TYPE;
        this.lol_entries = entries;
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
        the JSON with a tab. */
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
        default: throw("Unknown type string: " + typeString);
        }
    }
    
    /** Pulls an object (typically a tree) identified by srcHash from
        the source store (src) to the destination store (dst) whose
        current state is dstHash (or null if destination is
        empty/uninitialized). */
    function sync(src, srcHash, dst, dstHash, cb) {
        dst.get(srcHash,
                function(ok, res) {
                    if (ok) {
                        if (res !== undefined) {
                            // Source object already in destination? We're done.
                            cb(true);
                        } else {
                            // Fetch source object and perform its custom sync logic.
                            src.get(srcHash, function(ok, res) {
                                if (ok) {
                                    if (res !== undefined) {
                                        var srcObj = parse(res);
                                        srcObj.sync(src, srcHash, dst, dstHash, cb);
                                    } else {
                                        cb(false, "Source object " + srcHash + 
                                           " missing in source store " + src);
                                    }
                                } else {
                                    cb(false, res);
                                }
                            });
                        }
                    } else {
                        cb(false, res);
                    }
                });
    }

    Blob.prototype.sync = function(src, srcHash, dst, dstHash, cb) {
        dst.put(hash(this), content(this), cb);
    };

    Tree.prototype.sync = function(src, srcHash, dst, dstHash, cb) {
        var srcObj = this;
        if (dstHash !== null) {
            dst.get(dstHash, function(ok, res) {
                if (ok) {
                    if (res !== undefined) {
                        var dstObj = parse(res);
                        if (dstObj.lol_type === TREE_TYPE) {
                            treeSync(src, srcObj, dst, dstObj, cb);
                        } else {
                            treeSync(src, srcObj, dst, null, cb);
                        }
                    } else {
                        treeSync(src, srcObj, dst, null, cb);                        
                    }
                } else {
                    cb(false, res);
                }
            });
        } else {
            treeSync(src, srcObj, dst, null, cb);
        }
    };

    function treeSync(src, srcTree, dst, dstTree, cb) {
        // This callback gets called after all children have been synced.
        function treeCB(ok) {
            if (ok) {
                dst.put(hash(srcTree), content(srcTree), cb);
            } else {
                cb(false, "Failed to sync tree " + hash(srcTree));
            }
        }

        var srcEntries = srcTree.lol_entries;
        var dstEntries = (dstTree !== null) ? dstTree.lol_entries : {};
        var diff = [];

        for (var name in srcEntries) {
            var srcHash = srcEntries[name];
            var dstHash = dstEntries[name];
            if (dstHash === undefined) {
                diff.push({ srcHash: srcHash, dstHash: null });
            } else if (dstHash !== srcHash) {
                diff.push({ srcHash: srcHash, dstHash: dstHash });
            }
        }

        if (diff.length > 0) {
            var multiCB = multiCallback(diff.length, treeCB);
            for (var i = 0; i < diff.length; i++) {
                var entry = diff[i];
                sync(src, entry.srcHash, dst, entry.dstHash, multiCB);
            }
        } else {
            treeCB(true);
        }
    }

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

    /*
      EXPORTS
      ------------------------------------------------------------------
    */

    return {
        "Blob": Blob,
        "LocalStore": LocalStore,
        "RemoteStore": RemoteStore,
        "Tree": Tree,
        "content": content,
        "hash": hash,
        "parse": parse,
        "sync": sync,
    };

}());
