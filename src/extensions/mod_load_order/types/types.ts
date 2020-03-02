import * as Promise from 'bluebird';
import { types } from 'vortex-api';

export interface ILoadOrderEntry {
  pos: number;
  enabled: boolean;
  locked?: boolean;
}

export interface ILoadOrder {
  [modId: string]: ILoadOrderEntry;
}

export interface IDnDConditionResult {
  // Dictates whether the DnD action can be performed.
  success: boolean;

  // Why has the DnD condition failed ? This will be
  //  displayed on the Load Order screen to the user.
  errMessage?: string;
}

export interface ILoadOrderDisplayItem {
  // mod Id as stored in Vortex
  id: string;

  // mod display name.
  name: string;

  // the url pointing to the mod's display image.
  imgUrl: string;

  // Some game mod patterns require a prefix to be set.
  //  (e.g. 7dtd, etc)
  prefix?: string;

  // Is this mod locked - locked mods are not draggable.
  locked?: boolean;

  // An optional message which can be displayed beneath the mod's
  //  image.
  message?: string;

  // Allow game extensions to provide a condition functor
  //  during the preSort function call. This is useful if
  //  the game extension wants to impose some DnD restrictions
  //  e.g. Disallow ESP's or ESL's from being positioned above an ESM
  condition?: (lhs: ILoadOrderDisplayItem,
               rhs: ILoadOrderDisplayItem) => IDnDConditionResult;
}

export interface IGameLoadOrderEntry {
  // The domain gameId for this entry.
  gameId: string;

  // Load order information that the extension wishes
  //  to display on the side panel.
  loadOrderInfo: string;

  // The path to the game extension's default image.
  gameArtURL: string;

  // Give the game extension the opportunity to modify the load order
  //  before we start sorting the mods.
  preSort?: (items: ILoadOrderDisplayItem[]) => Promise<ILoadOrderDisplayItem[]>;

  // Allow game extensions to run custom filtering logic
  //  and display only mods which need to be sorted.
  //  This can obviously be done during the sort function call
  //  reason why this is optional.
  filter?: (mods: types.IMod[]) => types.IMod[];

  // Allow game extensions to react whenever the load order
  //  changes.
  callback?: (loadOrder: ILoadOrder) => void;

  // Add option to provide a custom item renderer if wanted.
  //  Default item renderer will be used if left undefined.
  itemRenderer?: React.ComponentClass<{
    className?: string;
    item: ILoadOrderDisplayItem;
    onRef: (ref: any) => any;
  }>;
}
