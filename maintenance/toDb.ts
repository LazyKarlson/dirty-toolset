import {Db, UserSchema, KarmaSchema} from '../src/db';
import {UserErrorResponse} from '../src/types';
import {getUser} from '../src/ajax';
import {karma} from '../src/iterators';
import {note} from '../src/notes';

const fromId: number = parseInt(process.argv[2], 10) || 1;
const toId: number = parseInt(process.argv[3], 10) || Number.MAX_SAFE_INTEGER;

(async function (fromId: number, toId: number) {
  const db = new Db();
  await db.connect();
  const users = await db.users();
  const karmas = await db.karma();

  const maxErrors = 1000;
  let errortsLeft = maxErrors;

  for (let userId = fromId; userId < toId && errortsLeft > 0; userId++) {
    if (await users.findOne({'dude.id': userId})) {
      console.log(`User ID ${userId} is already processed.`);
      continue;
    }
    const response = await getUser(userId);
    if (response.status === 'OK') {
      errortsLeft = maxErrors;
      console.log(userId, response.dude.login);
      if (response.dude.login === '') {
        continue;
      }
      const checked = new Date().toISOString().substr(0, 10);
      for await (const vote of karma(response.dude.login)) {
        // этот документ мы запишем
        const doc: KarmaSchema = {
          from: vote.user.login,
          fromId: vote.user.id,
          to: response.dude.login,
          toId: response.dude.id,
          vote: vote.vote,
          changed: vote.changed,
          date: new Date(vote.changed * 1000).toISOString().substr(0, 10),
          checked: checked,
          deleted: false,
        };
        // но сначала мы пометим как удаленный, предыдущий голос (если был)
        await karmas.updateMany(
          {
            fromId: doc.fromId,
            toId: doc.toId,
            vote: doc.vote,
            changed: {$ne: doc.changed},
            deleted: false,
          },
          {$set: {deleted: true}}
        );

        try {
          // если голос уже записан,
          await karmas.updateOne(
            {
              fromId: doc.fromId,
              toId: doc.toId,
              changed: doc.changed,
              vote: doc.vote,
              deleted: false,
            },
            {$set: doc}, // перезапишем с новым checked
            {upsert: true} // или запишем новый голос
          );
        } catch (error) {
          console.log(error);
        }
      }

      // все последние голоса в карму пользователя записаны,
      // отмечаем как удаленные те голоса, которые не были только что обновлены
      await karmas.updateMany(
        {
          toId: response.dude.id,
          checked: {$ne: checked},
          deleted: false,
        },
        {$set: {deleted: true}}
      );

      let yourbunnywrote: string | null = null;
      
      try {
        yourbunnywrote = await note(response.dude.login, process.env.USERNAME);
      } catch(error) {
        console.error(error);
      }
      
      const doc: UserSchema = {
        _id: response.dude.login,
        status: response.status,
        subscribers_count: response.subscribers_count,
        dude: {
          city: response.dude.city,
          country: response.dude.country,
          deleted: response.dude.deleted,
          gender: response.dude.gender,
          subscribers_count: response.dude.subscribers_count,
          karma: response.dude.karma,
          login: response.dude.login,
          active: response.dude.active,
          id: response.dude.id,
        },
        comments_count: response.comments_count,
        posts_count: response.posts_count,
        yourbunnywrote: yourbunnywrote
      };
      await users.insertOne(doc);
    } else {
      console.log(
        userId,
        (response as UserErrorResponse).errors,
        --errortsLeft,
        'errors left'
      );
    }
  }

  await db.close();
})(fromId, toId).catch(reason => console.log(reason));
