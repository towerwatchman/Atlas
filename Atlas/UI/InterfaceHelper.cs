﻿using System.Windows;
using System.Windows.Controls;

namespace Atlas.UI
{
    public static class InterfaceHelper
    {
        public static ListBox Listbox { get; set; }
        public static DataGrid Datagrid { get; set; }
        public static ProgressBar GameScannerProgressBar { get; set; }

        public static TextBox PotentialGamesTextBox { get; set; }
        public static ProgressBar SplashProgressBar { get; internal set; }
        public static double ProgressBarStartValue { get; set; } 
        public static TextBox SplashTextBox { get; internal set; }
        public static Splash SplashWindow { get; internal set; }
        public static TextBlock ImporterScanTextBox { get; set; }
        public static ListView BannerView { get; set; }
        public static Window MainWindow { get; set; }
    }
}
