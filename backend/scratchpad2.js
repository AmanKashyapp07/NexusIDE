const Y = require('yjs');
const doc = new Y.Doc();
const ytext = doc.getText('monaco');

doc.clientID = 1;
ytext.insert(0, 'A');
ytext.insert(1, 'B');

let curr = ytext._start;
while (curr) {
  console.log('clock:', curr.id.clock, 'content:', curr.content.getContent().join(''), 'length:', curr.length);
  curr = curr.right;
}

console.log("---");
ytext.delete(0, 1);
curr = ytext._start;
while (curr) {
  console.log('clock:', curr.id.clock, 'deleted:', curr.deleted, 'content:', curr.content.getContent().join(''));
  curr = curr.right;
}
