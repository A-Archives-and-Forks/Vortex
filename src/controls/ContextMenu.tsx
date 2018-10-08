import { IActionDefinitionEx } from './ActionControl';
import Dropdown from './Dropdown';
import Icon from './Icon';

import * as React from 'react';
import { MenuItem } from 'react-bootstrap';
import { Portal } from 'react-overlays';
import { ComponentEx } from '../util/ComponentEx';

export interface IMenuActionProps {
  id: string;
  action: IActionDefinitionEx;
  instanceId: string | string[];
}

class MenuAction extends React.PureComponent<IMenuActionProps, {}> {
  public render(): JSX.Element {
    const { action, id } = this.props;
    return (
      <MenuItem
        eventKey={id}
        onSelect={this.trigger}
        disabled={action.show !== true}
        title={typeof(action.show) === 'string' ? action.show : undefined}
      >
        {action.icon !== undefined ? <Icon name={action.icon} /> : null}
        <div className='button-text'>{action.title}</div>
      </MenuItem>
    );
  }

  private trigger = () => {
    const { action, instanceId } = this.props;

    const instanceIds = typeof(instanceId) === 'string' ? [instanceId] : instanceId;

    action.action(instanceIds);
  }
}

class RootCloseWrapper extends React.Component<{ onClose: () => void }, {}> {
  public componentDidMount() {
    document.addEventListener('click', this.props.onClose);
    document.addEventListener('contextmenu', this.props.onClose);
  }

  public componentWillUnmount() {
    document.removeEventListener('click', this.props.onClose);
    document.removeEventListener('contextmenu', this.props.onClose);
  }

  public render() {
    return this.props.children;
  }
}

export interface IContextMenuProps {
  position: { x: number, y: number };
  visible: boolean;
  onHide: () => void;
  instanceId: string;
  actions?: IActionDefinitionEx[];
}

type IProps = IContextMenuProps;

interface IComponentState {
  right?: number;
  bottom?: number;
}

class ContextMenu extends ComponentEx<IProps, IComponentState> {
  private mMenuRef: HTMLDivElement = null;

  constructor(props: IProps) {
    super(props);

    this.initState({});
  }

  public componentWillReceiveProps(newProps: IProps) {
    if ((this.props.visible !== newProps.visible)
        && newProps.visible) {
      this.updatePlacement(newProps.position);
    }
  }

  public render(): JSX.Element {
    const { actions, children, onHide, position, visible } = this.props;
    const { right, bottom } = this.state;
    if (!visible) {
      return null;
    }

    const menuStyle: React.CSSProperties = { position: 'absolute' };
    if (right !== undefined) {
      menuStyle['right'] = right;
    } else {
      menuStyle['left'] = position.x;
    }

    if (bottom !== undefined) {
      menuStyle['bottom'] = bottom;
    } else {
      menuStyle['top'] = position.y;
    }

    return (
      <RootCloseWrapper onClose={onHide}>
        <Portal
          container={this.context.menuLayer}
        >
          <div
            style={menuStyle}
            ref={this.setMenuRef}
          >
            <div className='menu-content'>{children}</div>
            <Dropdown.Menu
              style={{ display: 'block', position: 'initial' }}
              onClose={onHide}
              open={true}
              onClick={onHide}
            >
              {actions.map(this.renderMenuItem)}
            </Dropdown.Menu>
          </div>
        </Portal>
      </RootCloseWrapper>
    );
  }

  private renderMenuItem = (action: IActionDefinitionEx, index: number) => {
    const { instanceId } = this.props;

    const id = `${instanceId || '1'}_${index}`;

    if ((action.icon === null) && (action.component === undefined)) {
      return (
        <MenuItem className='menu-separator-line' key={id} disabled={true}>
          {action.title}
        </MenuItem>
      );
    }

    return <MenuAction key={id} id={id} action={action} instanceId={instanceId} />;
  }

  private setMenuRef = (ref: HTMLDivElement) => {
    this.mMenuRef = ref;
    if (ref !== null) {
      this.updatePlacement(this.props.position);
    }
  }

  private updatePlacement(position: { x: number, y: number }) {
    if (this.mMenuRef === null) {
      return;
    }

    const rect: ClientRect = this.mMenuRef.getBoundingClientRect();
    const outer: ClientRect = (this.context.menuLayer as any).getBoundingClientRect();

    if ((position.y + rect.height) > outer.bottom) {
      this.nextState.bottom = outer.bottom - position.y;
    } else {
      this.nextState.bottom = undefined;
    }

    if ((position.x + rect.width) > outer.right) {
      this.nextState.right = outer.right - position.x;
    } else {
      this.nextState.right = undefined;
    }
  }
}

export default ContextMenu as React.ComponentClass<IContextMenuProps>;
