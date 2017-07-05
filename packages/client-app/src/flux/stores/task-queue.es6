import _ from 'underscore';
import NylasStore from 'nylas-store';
import {Rx} from 'nylas-exports';
import Task from "../tasks/task";
import DatabaseStore from './database-store';

/**
Public: The TaskQueue is a Flux-compatible Store that manages a queue of {Task}
objects. Each {Task} represents an individual API action, like sending a draft
or marking a thread as "read". Tasks optimistically make changes to the app's
local cache and encapsulate logic for performing changes on the server, rolling
back in case of failure, and waiting on dependent tasks.

The TaskQueue is essential to offline mode in N1. It automatically pauses
when the user's internet connection is unavailable and resumes when online.

The task queue is persisted to disk, ensuring that tasks are executed later,
even if the user quits N1.

The TaskQueue is only available in the app's main window. Rather than directly
queuing tasks, you should use the {Actions} to interact with the {TaskQueue}.
Tasks queued from secondary windows are serialized and sent to the application's
main window via IPC.

## Queueing a Task

```coffee
if @_thread && @_thread.unread
  Actions.queueTask(new ChangeStarredTask(thread: @_thread, starred: true))
```

## Dequeueing a Task

```coffee
Actions.dequeueMatchingTask({
  type: 'DestroyCategoryTask',
  matching: {
    categoryId: 'bla'
  }
})
*/
class TaskQueue extends NylasStore {
  constructor() {
    super();
    this._queue = [];
    this._completed = [];
    this._currentSequentialId = Date.now();

    this._waitingForLocal = [];
    this._waitingForRemote = [];

    Rx.Observable.fromQuery(DatabaseStore.findAll(Task)).subscribe((tasks => {
      this._queue = tasks.filter(t => t.status !== 'complete');
      this._completed = tasks.filter(t => t.status === 'complete');
      const all = [].concat(this._queue, this._completed);

      this._waitingForLocal.filter(({task, resolve}) => {
        const match = all.find(t => task.id === t.id);
        if (match) {
          resolve(match);
          return false;
        }
        return true;
      });

      this._waitingForRemote.filter(({task, resolve}) => {
        const match = this._completed.find(t => task.id === t.id);
        if (match) {
          resolve(match);
          return false;
        }
        return true;
      });

      this.trigger();
    }));
  }

  queue() {
    return this._queue;
  }

  completed() {
    return this._completed;
  }

  allTasks() {
    return [].concat(this._queue, this._completed);
  }

  /*
  Public: Returns an existing task in the queue that matches the type you provide,
  and any other match properties. Useful for checking to see if something, like
  a "SendDraft" task is in-flight.

  - `type`: The string name of the task class, or the Task class itself. (ie:
    {SaveDraftTask} or 'SaveDraftTask')

  - `matching`: Optional An {Object} with criteria to pass to _.isMatch. For a
     SaveDraftTask, this could be {headerMessageId: "123123"}

  Returns a matching {Task}, or null.
  */
  findTask(type, matching = {}) {
    this.findTasks(type, matching).unshift();
  }

  findTasks(typeOrClass, matching = {}, {includeCompleted} = {}) {
    const type = typeOrClass instanceof String ? typeOrClass : typeOrClass.name;
    const tasks = includeCompleted ? [].concat(this._queue, this._completed) : this._queue;

    const matches = tasks.filter((task) => {
      if (task.constructor.name !== type) { return false; }
      if (matching instanceof Function) {
        return matching(task);
      }
      return _.isMatch(task, matching);
    });

    return matches;
  }

  waitForPerformLocal = (task) => {
    return new Promise((resolve) => {
      this._waitingForLocal.push({task, resolve});
    });
  }

  waitForPerformRemote = (task) => {
    return new Promise((resolve) => {
      this._waitingForRemote.push({task, resolve});
    });
  }

  // Helper Methods

  _resolveTaskArgument(taskOrId) {
    if (!taskOrId) {
      return null;
    }
    if (taskOrId instanceof Task) {
      return this._queue.find(task => task === taskOrId);
    }
    return this._queue.find(t => t.id === taskOrId);
  }
}

export default new TaskQueue();
