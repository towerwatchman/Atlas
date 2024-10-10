﻿using Atlas.Core;
using Atlas.UI.Importer;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media.Imaging;

namespace Atlas
{
    /// <summary>
    /// Interaction logic for MainWindow.xaml
    /// </summary>
    public partial class MainWindow : Window
    {
        private List<Game> GameList = new List<Game>();
        public MainWindow()
        {
            InitializeComponent();
            EventManager.RegisterClassHandler(typeof(ListBoxItem), ListBoxItem.MouseLeftButtonUpEvent, new RoutedEventHandler(this.OnListBoxNavButtonUp));

            this.BannerView.ItemsSource = GameList;
            this.GameListBox.ItemsSource = GameList;

            BannerView.MouseUp += BannerView_MouseUp;
        }

        private void BannerView_MouseUp(object sender, MouseButtonEventArgs e)
        {
            if (this.BannerView.ItemsSource != null)
            {
                Game game = BannerView.SelectedItem as Game;
                if (game != null)
                {
                    miPlay.Items.Clear();

                    foreach(GameVersion version in game.Versions)
                    {
                        MenuItem menuItem = new MenuItem();
                        menuItem.Tag = version.ExePath;
                        menuItem.Header = version.Version;
                        menuItem.Click += MenuItem_Click;
                        miPlay.Items.Add(menuItem);
                    }
                    //MessageBox.Show(game.Title);
                }
            }
        }

        private void MenuItem_Click(object sender, RoutedEventArgs e)
        {
            MenuItem obMenuItem = e.OriginalSource as MenuItem;
            LaunchExeProcess(obMenuItem.Tag.ToString());
        }

        //Move to another class
        private async void LaunchExeProcess(string executable)
        {
            await Task.Run(() =>
            {
                Process proc = new Process();
                proc.EnableRaisingEvents = true;
                proc.StartInfo.UseShellExecute = true;

                //proc.Exited += EclipseInstanceClosed;
                //proc.Disposed += EclipseInstanceDisposed;

                proc.StartInfo.FileName = executable;

                proc.Start();
            });
        }

        private void MinimizeButton_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState.Minimized;
        }

        private void MaximizeButton_Click(object sender, RoutedEventArgs e)
        {
            if (WindowState == WindowState.Normal)
            {
                WindowState = WindowState.Maximized;
                this.BorderThickness = new System.Windows.Thickness(7);
            }
            else
            {
                WindowState = WindowState.Normal;
                this.BorderThickness = new System.Windows.Thickness(0);
            }

        }
        private void CloseButton_Click(object sender, RoutedEventArgs e)
        {
            System.Windows.Application.Current.Shutdown();
        }

        private void OnListBoxNavButtonUp(object sender, RoutedEventArgs e)
        {
            var Item = (ListBoxItem)sender;
            Console.WriteLine(Item.Name);
            if (Item.Name.ToString() == "Import")
            {
                BatchImporter batchImporter = new BatchImporter();
                //Set event handler to start parsing games once 
                batchImporter.btn_import.Click += Btn_Import_Click;
                batchImporter.WindowStartupLocation = WindowStartupLocation.CenterScreen;
                batchImporter.Show();
            }
        }

        private void Btn_Import_Click(object sender, RoutedEventArgs e)
        {
            //This will take each game detail that was imported and change it into an actual game.
            //We have to take this list and put all version in a seperate class. Once this is complete we add to database.
            //after adding to database we can import to the BannerView
            foreach (var GameDetail in GameScanner.GameDetailList)
            {
                //We need to insert in to database first then get the id of the new item
                int recordID = 0;
                bool GameExist = GameList.Any(x=> GameDetail.Creator == x.Creator && GameDetail.Title == x.Title);
                if (GameExist)
                {

                }
                else
                {
                    List<GameVersion> gameVersions = new List<GameVersion>();
                    gameVersions.Add(new GameVersion
                    {
                        Version = GameDetail.Version,
                        DateAdded = DateTime.Now,
                        ExePath = System.IO.Path.Combine(GameDetail.Folder, GameDetail.Executable[0]),
                        GamePath = GameDetail.Folder,
                        RecordId = recordID
                    });

                    GameList.Add(new Game { 
                        Creator = GameDetail.Creator, 
                        Title = GameDetail.Title, 
                        Versions = gameVersions, 
                        Engine = GameDetail.Engine, 
                        Status = "", 
                        ImageData = LoadImage("") 
                    });
                }
                
                BannerView.Items.Refresh();
                GameListBox.Items.Refresh();
            }

            //sort items in lists
            GameListBox.Items.SortDescriptions.Add(new System.ComponentModel.SortDescription("Title",System.ComponentModel.ListSortDirection.Ascending));

        }

        private BitmapImage LoadImage(string path)
        {
            var image = new BitmapImage(new Uri("pack://application:,,,/Assets/Images/default.jpg"));
            if (path == "")
            {
                return image;
            }
            else
            {
                try
                {
                    var uri = new Uri(path);
                    return new BitmapImage(uri);
                }
                catch (Exception ex)
                {
                    Console.WriteLine(ex.Message);
                    return image;
                }
            }
        }

        private void Window_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            /*
            double bannerX = (double)Application.Current.Resources["bannerX"];
            double bannerViewWidth = BannerView.ActualWidth;
            double rows = bannerViewWidth / bannerX;
            Console.WriteLine($"{bannerX} {bannerViewWidth} {rows}");

            Application.Current.Resources["Rows"] = (int)rows;
            Console.WriteLine(Application.Current.Resources["Rows"]);*/
        }

        private void Window_MouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ChangedButton == MouseButton.Left)
                this.DragMove();
        }
    }
}