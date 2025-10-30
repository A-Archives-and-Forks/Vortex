/**
 * CollectionTile Component
 * Displays a collection card with image, metadata, and action buttons
 * Adapted from Figma design for collection browsing
 */

import * as React from 'react';
import { Button } from '../button/Button';
import { Typography } from '../typography/Typography';
import { Icon } from '../icon';
import { nxmFileSize, nxmMod } from '../../../lib/icon-paths';
import numeral from 'numeral'; 
import { IExtensionApi } from '../../../../types/IExtensionContext';
import { isCollectionModPresent, activeDownloads } from '../../../../util/selectors';
import { useSelector } from 'react-redux';
import { IDownload } from '../../../../types/IState';
import Debouncer from '../../../../util/Debouncer';

const debouncer = new Debouncer((func: () => void) => {
  func?.();
  return Promise.resolve();
}, 5000);

export interface CollectionTileProps {
  // Data
  id: string;
  slug: string;
  gameId: string;
  title: string;
  author: {
    name: string;
    avatar?: string;
  };
  coverImage: string;
  tags: string[];  // Max 2 tags
  stats: {
    endorsements: number;
    modCount: number;
    size: number;  // e.g., '540MB'
  };
  description: string;
  version?: string;

  // Actions
  onAddCollection?: () => void;
  onViewPage?: () => void;

  // Style
  className?: string;
}

export const CollectionTile: React.ComponentType<CollectionTileProps & { api: IExtensionApi }> = ({
  api,
  slug,
  gameId,
  title,
  author,
  coverImage,
  tags,
  stats,
  description,
  onAddCollection,
  onViewPage,
  className,
}) => {
  const [isHovered, setIsHovered] = React.useState(false);
  const [canBeAdded, setCanBeAdded] = React.useState(true);
  const [tooltip, setTooltip] = React.useState<string>('Add this collection');
  const [pending, setPending] = React.useState(false);
  // Helper to extract tag text from string or object
  const getTagText = (tag: any): string => {
    if (typeof tag === 'string') {
      return tag;
    }
    if (tag && typeof tag === 'object' && 'name' in tag) {
      return String(tag.name);
    }
    return String(tag);
  };

  const addCollectionDebounced = () => {
    debouncer.schedule(() => setPending(false), () => {
      onAddCollection?.();
    });
  };

  React.useEffect(() => {
    const collectionModInstalled = isCollectionModPresent(
      api.getState(),
      slug,
    );
    setCanBeAdded(!collectionModInstalled);
    setTooltip(collectionModInstalled || pending ? 'Collection already added' : 'Add this collection');
  }, [api, slug, isHovered, pending]);

  // Take max 2 tags
  const displayTags = tags.slice(0, 2);
  const addCollection = React.useCallback(() => {
    if (!pending && canBeAdded) {
      setPending(true);
      addCollectionDebounced();
    }
  }, [onAddCollection, canBeAdded, pending]);
  const mouseEnter = React.useCallback(() => {
    setIsHovered(true);
  }, []);
  const mouseLeave = React.useCallback(() => {
    setIsHovered(false);
  }, []);
  return (
    <div
      className={`tw:w-full tw:max-w-[465px] tw:h-[283px] tw:bg-surface-mid tw:flex tw:flex-col tw:justify-start tw:items-start ${className || ''}`}
      onMouseEnter={mouseEnter}
      onMouseLeave={mouseLeave}
    >
      {/* Main content area */}
      <div className="tw:self-stretch tw:flex-1 tw:px-3 tw:pt-3 tw:rounded-tl tw:rounded-tr tw:flex tw:flex-col tw:justify-start tw:items-start tw:gap-2 tw:overflow-hidden">
        <div className="tw:self-stretch tw:flex tw:flex-1 tw:justify-between tw:items-start">

          {/* Left: Image */}
          <div className="tw:w-[175px] tw:h-[219px] tw:relative tw:shrink-0">
            <img
              className="tw:w-[166px] tw:h-[208px] tw:absolute tw:top-0 tw:left-0 tw:rounded-sm tw:object-cover"
              src={coverImage}
              alt={title}
            />
          </div>

          {/* Right: Details */}
          <div className="tw:flex-1 tw:self-stretch tw:flex tw:flex-col tw:justify-start tw:items-start">

            {/* Header: Title + Author */}
            <div className="tw:self-stretch tw:pl-3 tw:pb-2 tw:flex tw:flex-col tw:justify-start tw:items-start tw:gap-0">
              <Typography
                as="div"
                className="tw:line-clamp-1 tw:font-semibold tw:break-words"
                appearance="strong"
                typographyType="body-xl"
              >
                {title}
              </Typography>

              <div className="tw:flex tw:items-center tw:gap-1">
                {author.avatar && (
                  <img
                    src={author.avatar}
                    alt={author.name}
                    className="tw:w-4 tw:h-4 tw:rounded-full tw:bg-zinc-300"
                  />
                )}
                {!author.avatar && (
                  <div className="tw:w-4 tw:h-4 tw:bg-zinc-300 tw:rounded-full" />
                )}
                <Typography
                  as="div"
                  typographyType="body-xs"
                  appearance="moderate"
                  className="tw:justify-center tw:tracking-tight"
                >
                  {author.name}
                </Typography>
              </div>
            </div>

            {/* Tags section */}
            {displayTags.length > 0 && (
              <div className="tw:self-stretch tw:pl-3 tw:flex tw:flex-col tw:justify-start tw:items-start tw:gap-2">
                <div className="tw:self-stretch tw:py-1.5 tw:border-t tw:border-b tw:border-stroke-neutral-translucent-weak tw:inline-flex tw:justify-start tw:items-center tw:gap-1.5 tw:flex-wrap tw:content-center">
                  {displayTags.map((tag, index) => {
                    const tagText = getTagText(tag);
                    return (
                      <React.Fragment key={index}>
                        <Typography
                          as="div"
                          typographyType="body-xs"
                          appearance="none"
                          className={`tw:justify-center tw:tracking-tight ${tagText.toLowerCase() === 'adult'
                            ? 'tw:text-danger-strong'
                            : 'tw:text-info-strong'
                            }`}
                        >
                          {tagText}
                        </Typography>
                        {index < displayTags.length - 1 && (
                          <div className="tw:w-1 tw:h-1 tw:rotate-45 tw:bg-neutral-subdued" />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Stats section */}
            <div className="tw:self-stretch tw:pl-3 tw:inline-flex tw:justify-start tw:items-center tw:gap-5">
              <div className="tw:flex-1 tw:py-1.5 tw:border-b tw:border-stroke-neutral-translucent-weak tw:flex tw:justify-start tw:items-center tw:gap-5">

                {/* Endorsements */}
                <div className="tw:flex tw:justify-start tw:items-center tw:gap-1 tw:overflow-hidden">

                  <Icon path="mdiThumbUp" size="sm"  />                  
                  <Typography
                    as="div"
                    typographyType="body-xs"
                    appearance="moderate"
                    className="tw:justify-start tw:tracking-tight"
                  >
                    { numeral(stats.endorsements).format('0 a') }
                  </Typography>
                </div>


                {/* Size */}
                <div className="tw:flex tw:justify-center tw:items-center tw:gap-1 tw:overflow-hidden">
                  <Icon path={nxmFileSize} size="sm" />
                  <Typography
                    as="div"
                    typographyType="body-xs"
                    appearance="moderate"
                    className="tw:justify-start tw:tracking-tight"
                  >
                    {numeral(stats.size).format('0.0 b')}
                  </Typography>
                </div>

                {/* Mod count */}
                <div className="tw:flex tw:justify-center tw:items-center tw:gap-1 tw:overflow-hidden">
                  <Icon path={nxmMod} size="sm" />
                  <Typography
                    as="div"
                    typographyType="body-xs"
                    appearance="moderate"
                    className="tw:justify-start tw:tracking-tight"
                  >
                    { numeral(stats.modCount).format('0,0') }
                  </Typography>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="tw:self-stretch tw:flex-1 tw:pl-3 tw:py-1 tw:flex tw:flex-col tw:justify-start tw:items-start tw:gap-2">
              <Typography
                as="div"
                typographyType="body-md"
                appearance="subdued"
                className="tw:line-clamp-4 tw:break-words tw:leading-tight"
              >
                {description}
              </Typography>
            </div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="tw:self-stretch tw:p-3 tw:bg-surface-high tw:rounded-bl tw:rounded-br tw:inline-flex tw:justify-start tw:items-center tw:gap-2">
        <Button
          title={tooltip}
          disabled={!canBeAdded || pending}
          buttonType="primary"
          size="sm"
          onClick={addCollection}
        >
          Add collection
        </Button>

        <Button
          buttonType="tertiary"
          size="sm"
          onClick={onViewPage}
          leftIconPath="mdiOpenInNew"
        >
          View page
        </Button>
      </div>
    </div>
  );
};
