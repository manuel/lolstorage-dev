function consoleCB(ok, res) {
    if (ok) {
        console.log("OK");
        if (res !== undefined)
            console.log(res);
    } else {
        console.error("Error: " + res);
    }
}

var s1 = new lol.LocalStore("s1");
var s2 = new lol.LocalStore("s2");

var file = new lol.Blob("Hello world!");

var subTree = new lol.Tree([new lol.TreeEntry("hello-world.txt", lol.hash(file))]);
var tree = new lol.Tree([new lol.TreeEntry("sub-tree", lol.hash(subTree))]);

s1.put(lol.hash(file), lol.content(file), consoleCB);
s1.put(lol.hash(subTree), lol.content(subTree), consoleCB);
s1.put(lol.hash(tree), lol.content(tree), consoleCB);

lol.pull(lol.hash(tree), s1, s2, consoleCB);
