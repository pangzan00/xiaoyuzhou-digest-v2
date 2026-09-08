/// <reference types="vite/client" />

// Chrome Extension types
declare namespace Chrome {
  interface Runtime {
    sendMessage(
      extensionId?: string,
      message?: any,
      options?: any,
      responseCallback?: (response: any) => void
    ): void;
    sendMessage(message: any, responseCallback?: (response: any) => void): void;
    onMessage: chrome.events.Event<
      (
        message: any,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: any) => void
      ) => boolean | void
    >;
    onInstalled: chrome.events.Event<(details: chrome.runtime.InstalledDetails) => void>;
    onConnect: chrome.events.Event<(port: chrome.runtime.Port) => void>;
    openOptionsPage(callback?: () => void): void;
    getURL(path: string): string;
    id: string;
  }

  interface SidePanel {
    setOptions(options: {
      tabId?: number;
      path?: string;
      enabled?: boolean;
    }): Promise<void>;
    open(options?: { tabId?: number }): Promise<void>;
    setPanelBehavior(options: { openPanelOnActionClick?: boolean }): Promise<void>;
  }

  interface Tabs {
    sendMessage(
      tabId: number,
      message: any,
      options?: any,
      responseCallback?: (response: any) => void
    ): void;
    query(queryInfo: chrome.tabs.QueryInfo, callback?: (result: chrome.tabs.Tab[]) => void): Promise<chrome.tabs.Tab[]>;
    create(createProperties: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void): Promise<chrome.tabs.Tab>;
    get(tabId: number, callback?: (tab: chrome.tabs.Tab) => void): Promise<chrome.tabs.Tab>;
    onUpdated: chrome.events.Event<
      (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void
    >;
    onActivated: chrome.events.Event<(activeInfo: chrome.tabs.ActiveInfo) => void>;
  }

  interface StorageChange {
    oldValue?: any;
    newValue?: any;
  }

  interface Storage {
    local: {
      get(keys: string | string[] | null | object, callback?: (items: { [key: string]: any }) => void): Promise<{ [key: string]: any }>;
      set(items: object, callback?: () => void): Promise<void>;
      remove(keys: string | string[], callback?: () => void): Promise<void>;
      clear(callback?: () => void): Promise<void>;
      setAccessLevel(accessLevel: { accessLevel: string }): Promise<void>;
    };
    onChanged: chrome.events.Event<(
      changes: { [key: string]: StorageChange },
      areaName: string
    ) => void>;
  }
  interface Action {
    onClicked: chrome.events.Event<(tab: chrome.tabs.Tab) => void>;
  }
}

declare const chrome: typeof window.chrome & {
  runtime: Chrome.Runtime;
  sidePanel: Chrome.SidePanel;
  tabs: Chrome.Tabs;
  storage: Chrome.Storage;
  action: Chrome.Action;
};
