import { useEffect } from 'react';
import { markActivitySeen, readActivity } from '../../runtime/service/board';
import { ago } from '../common/time';
import { PagedList, usePages } from '../common/useLoaded';
import { BOARD } from '../common/words';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { ListItem, NavBar, Screen } from '../ui';
import { activityFace, activityLine } from './activity';

export function ActivityScreen({ back }: { back: Back }) {
  const pages = usePages((after) => readActivity(after));
  const newest = pages.rows?.[0]?.id;
  useEffect(() => {
    if (newest !== undefined) void markActivitySeen(newest);
  }, [newest]);
  return (
    <Screen width="form" top={<NavBar title={BOARD.activity} {...backBar(back)} />}>
      <PagedList pages={pages} head={false} label={BOARD.activity} empty="알림이 없어요.">
        {(activity) => <ListItem key={activity.id} leading={activityFace(activity)} title={activityLine(activity)} description={activity.title} note={ago(activity.at)} onClick={() => navigate({ kind: 'post', id: activity.postId })} />}
      </PagedList>
    </Screen>
  );
}
