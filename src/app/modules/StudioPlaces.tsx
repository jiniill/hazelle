import { History, LayoutPanelTop, MessageSquare, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { ActionCard, Columns } from '../ui';

// The places only a Hazelle plugin reaches (docs roadmap plugin-studio, "Why authors would come"); each card is a way in,
// pressing it fills the ask with that place's example.
export type Place = 'badge' | 'slot' | 'composer' | 'state';

export const PLACES: Record<Place, { icon: LucideIcon; title: string; description: string; ask: string }> = {
  badge: { icon: MessageSquare, title: '메시지 배지·버튼', description: '응답마다 배지를 달거나 메시지 ⋯에 버튼을 넣어요', ask: '응답이 올 때마다 공백을 뺀 글자 수를 세서 메시지 옆에 배지로 달아 줘.' },
  slot: { icon: LayoutPanelTop, title: '프롬프트·장기 기억', description: '요청마다 문구를 넣거나 기본 장기 기억을 대신해요', ask: '기본 장기 기억 대신, 대화에서 중요한 사실을 모아 두고 요청마다 프롬프트에 넣어 줘.' },
  composer: { icon: SlidersHorizontal, title: '설정·입력창 버튼', description: '헤더 한 줄로 설정과 버튼을 추가해요', ask: '입력창에 번역 버튼을 달아서, 누르면 입력한 한국어를 영어로 바꿔 줘.' },
  state: { icon: History, title: '채팅 상태·변수', description: '다시 생성하거나 분기해도 저장한 값이 그 시점으로 돌아가요', ask: '채팅마다 호감도를 저장하고, 다시 생성해도 그때의 값으로 돌아가게 해 줘.' },
};

export const isPlace = (value: string | null): value is Place => value !== null && value in PLACES;

export function StudioPlaces({ onPick }: { onPick: (place: Place) => void }) {
  return (
    <Columns min="wide">
      {(Object.keys(PLACES) as Place[]).map((place) => {
        const { icon, title, description } = PLACES[place];
        return <ActionCard key={place} icon={icon} title={title} description={description} onClick={() => onPick(place)} />;
      })}
    </Columns>
  );
}
