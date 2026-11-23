import { useMemo } from 'react';
import { pictureRef, type PictureUrl } from '../../engine/assets';
import { useAssetUrl } from '../session';
import { useVeilTaps, veiledSource } from '../ui';

// The addresses of the pictures in a story's markup. Under 이미지 가리기 a picture is read only once tapped open: until
// then its address loads nothing, and names it for the veil.
export function useStoryUrl(inputs: readonly unknown[]): PictureUrl {
  const { veil, taps } = useVeilTaps();
  const url = useAssetUrl([...inputs, veil, taps]);
  return useMemo(() => {
    if (!veil) return url;
    return (kind, id) => {
      const ref = pictureRef(kind, id);
      return veiledSource(ref, veil.shows(ref) ? url(kind, id) : undefined);
    };
  }, [url, veil]);
}
